import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processImportBatch, type ImportRow } from "@/lib/contacts-import.server";

// Chamado por pg_cron (a cada 1 min) ou disparado on-demand pelo enqueue.
// Idempotente: usa claim_next_pending_import + claim_next_import_batch (FOR UPDATE SKIP LOCKED).
export const Route = createFileRoute("/api/public/cron/contact-imports-drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deadline = Date.now() + 30_000;
        // Margem ampla para garantir que o worker consiga finalizar o lote
        // atual (UPDATE done + reenfileirar restante) antes de ser morto.
        const CLAIM_CUTOFF_MS = 10_000;
        const CONCURRENCY = 1;
        let importsHandled = 0;
        let batchesHandled = 0;
        const errors: string[] = [];

        // Fatia interna pequena (~1-2s por fatia). Cabem ~15-25 fatias por
        // execução. O drain auto-encadeia + pg_cron a cada minuto garantem
        // fluxo contínuo.
        const SUB_CHUNK = 50;

        async function processOneBatch(imp: any): Promise<"ok" | "empty" | "stop"> {
          const { data: batchArr, error: claimBatchErr } = await supabaseAdmin.rpc(
            "claim_next_import_batch",
            { _import_id: imp.id },
          );
          if (claimBatchErr) {
            await supabaseAdmin.from("contact_import_logs").insert({
              import_id: imp.id,
              level: "error",
              message: `Falha ao reservar lote: ${claimBatchErr.message}`,
            });
            return "stop";
          }
          const batch = (batchArr as any[])?.[0];
          if (!batch) return "empty";

          batchesHandled++;
          const rows = (batch.payload as ImportRow[]) ?? [];

          try {
            let aggCreated = 0, aggUpdated = 0, aggSkipped = 0, aggErrors = 0;
            let processedRows = 0;

            for (let off = 0; off < rows.length; off += SUB_CHUNK) {
              // Se o tempo está acabando, para — o restante será reenfileirado
              // como novos lotes pequenos (sem reprocessar nada já contado).
              if (Date.now() >= deadline - CLAIM_CUTOFF_MS) break;

              const slice = rows.slice(off, off + SUB_CHUNK);
              const res = await processImportBatch(imp.brand_id, slice, {
                updateExisting: imp.update_existing,
                tagIds: imp.tag_ids ?? [],
              });

              await supabaseAdmin.rpc("increment_import_counters", {
                _import_id: imp.id,
                _processed: slice.length,
                _created: res.created,
                _updated: res.updated,
                _skipped: res.skipped,
                _errors: res.errors.length,
              });

              aggCreated += res.created;
              aggUpdated += res.updated;
              aggSkipped += res.skipped;
              aggErrors += res.errors.length;
              processedRows += slice.length;

              if (res.errors.length > 0) {
                const sample = res.errors.slice(0, 50);
                const logRows = sample.map((e) => ({
                  import_id: imp.id,
                  level: "error",
                  row_index: e.row >= 0 ? e.row : null,
                  message: e.reason.slice(0, 1000),
                }));
                await supabaseAdmin.from("contact_import_logs").insert(logRows);
                if (res.errors.length > sample.length) {
                  await supabaseAdmin.from("contact_import_logs").insert({
                    import_id: imp.id,
                    level: "warn",
                    message: `... e mais ${res.errors.length - sample.length} erro(s) omitidos.`,
                  });
                }
              }
            }

            // Sobraram linhas? Reenfileira como NOVOS lotes pequenos.
            // Evita reprocessar linhas já contadas (sem duplicar counters).
            const remaining = rows.slice(processedRows);
            if (remaining.length > 0) {
              const { data: maxRow } = await supabaseAdmin
                .from("contact_import_batches")
                .select("batch_index")
                .eq("import_id", imp.id)
                .order("batch_index", { ascending: false })
                .limit(1)
                .maybeSingle();
              const startIdx = ((maxRow?.batch_index ?? batch.batch_index) as number) + 1;

              const newBatches: any[] = [];
              for (let i = 0; i < remaining.length; i += SUB_CHUNK) {
                newBatches.push({
                  import_id: imp.id,
                  batch_index: startIdx + Math.floor(i / SUB_CHUNK),
                  payload: remaining.slice(i, i + SUB_CHUNK),
                  status: "pending",
                });
              }
              const { error: insErr } = await supabaseAdmin
                .from("contact_import_batches")
                .insert(newBatches);
              if (insErr) throw new Error(`Falha ao reenfileirar restante: ${insErr.message}`);

              await supabaseAdmin.from("contact_import_logs").insert({
                import_id: imp.id,
                level: "info",
                message: `Lote #${batch.batch_index}: tempo esgotado, ${remaining.length} linha(s) reenfileiradas em ${newBatches.length} lote(s) menor(es).`,
              });
            }

            // Marca o lote original como done (a parte processada já contou).
            await supabaseAdmin
              .from("contact_import_batches")
              .update({ status: "done", processed_at: new Date().toISOString(), error: null })
              .eq("id", batch.id);

            await supabaseAdmin.from("contact_import_logs").insert({
              import_id: imp.id,
              level: aggErrors > 0 ? "warn" : "info",
              message: `Lote #${batch.batch_index}: ${aggCreated} criados, ${aggUpdated} atualizados, ${aggSkipped} pulados, ${aggErrors} erro(s) (${processedRows}/${rows.length} linhas).`,
            });
            return remaining.length > 0 ? "stop" : "ok";
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            errors.push(msg);
            await supabaseAdmin
              .from("contact_import_batches")
              .update({ status: "failed", processed_at: new Date().toISOString(), error: msg })
              .eq("id", batch.id);
            await supabaseAdmin.from("contact_import_logs").insert({
              import_id: imp.id,
              level: "error",
              message: `Lote #${batch.batch_index} falhou: ${msg}`,
            });
          }
          return "ok";
        }

        let anyPendingAtEnd = false;

        try {
          while (Date.now() < deadline) {
            const { data: impArr, error: claimImpErr } = await supabaseAdmin.rpc(
              "claim_next_pending_import",
            );
            if (claimImpErr) {
              errors.push(`claim_import: ${claimImpErr.message}`);
              break;
            }
            const imp = (impArr as any[])?.[0];
            if (!imp) break;
            importsHandled++;

            // Drena lotes em paralelo (CONCURRENCY workers).
            // claim_next_import_batch usa FOR UPDATE SKIP LOCKED, então é seguro.
            let exhausted = false;
            while (!exhausted && Date.now() < deadline - CLAIM_CUTOFF_MS) {
              const workers = Array.from({ length: CONCURRENCY }, () => processOneBatch(imp));
              const results = await Promise.all(workers);
              if (results.every((r) => r === "empty")) exhausted = true;
              if (results.some((r) => r === "stop")) break;
            }

            // Só considera o import terminado quando NÃO há lotes pendentes
            // NEM em processamento. Lotes em 'processing' podem ter sido
            // abandonados por workers anteriores que estouraram o tempo.
            const { count: openCount } = await supabaseAdmin
              .from("contact_import_batches")
              .select("id", { count: "exact", head: true })
              .eq("import_id", imp.id)
              .in("status", ["pending", "processing"]);

            if ((openCount ?? 0) === 0) {
              const { data: agg } = await supabaseAdmin
                .from("contact_import_batches")
                .select("status")
                .eq("import_id", imp.id);
              const anyFailed = (agg ?? []).some((b: any) => b.status === "failed");

              // Detecta lacuna: contadores < total mesmo com todos os lotes finalizados.
              // Indica batches marcados 'done' sem efeito real (resíduo de worker antigo).
              const { data: counts } = await supabaseAdmin
                .from("contact_imports")
                .select("total_rows, processed_rows")
                .eq("id", imp.id)
                .single();
              const total = counts?.total_rows ?? 0;
              const processed = counts?.processed_rows ?? 0;
              const gap = Math.max(0, total - processed);

              const finalStatus = anyFailed ? "failed" : "completed";
              const messages: string[] = [];
              if (anyFailed) messages.push("Um ou mais lotes falharam. Veja os logs.");
              if (gap > 0) messages.push(`${gap} linhas não foram processadas. Reimporte o arquivo para preencher (UPSERT evita duplicatas).`);

              await supabaseAdmin
                .from("contact_imports")
                .update({
                  status: finalStatus,
                  finished_at: new Date().toISOString(),
                  ...(messages.length ? { error_message: messages.join(" ") } : {}),
                })
                .eq("id", imp.id);
              await supabaseAdmin.from("contact_import_logs").insert({
                import_id: imp.id,
                level: anyFailed || gap > 0 ? "warn" : "info",
                message: gap > 0
                  ? `Importação finalizada (${finalStatus}) com ${gap} linha(s) não processada(s).`
                  : `Importação finalizada (${finalStatus}).`,
              });
            } else {
              anyPendingAtEnd = true;
            }
          }

          // Auto-encadeia: se ainda há lotes pendentes (neste import ou em outros),
          // dispara outra execução do drain sem esperar o próximo tick do cron.
          if (anyPendingAtEnd || Date.now() >= deadline) {
            try {
              const url = new URL(request.url);
              const selfUrl = `${url.origin}${url.pathname}`;
              fetch(selfUrl, { method: "POST" }).catch(() => {});
            } catch {
              // best-effort
            }
          }

          return Response.json({ ok: true, importsHandled, batchesHandled, errors });
        } catch (e: any) {
          console.error("[cron/contact-imports-drain]", e);
          return Response.json(
            { ok: false, error: e?.message ?? "drain failed", importsHandled, batchesHandled },
            { status: 500 },
          );
        }
      },
    },
  },
});

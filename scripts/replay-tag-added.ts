/**
 * One-shot: re-dispara `tag_added` para contatos com uma tag que ainda não
 * tiveram uma automation_run criada para a automação alvo.
 *
 * Uso:
 *   bun run scripts/replay-tag-added.ts <brandId> <tagName> <automationId>
 *
 * Requer env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const [brandId, tagName, automationId] = process.argv.slice(2);
if (!brandId || !tagName || !automationId) {
  console.error("Uso: bun run scripts/replay-tag-added.ts <brandId> <tagName> <automationId>");
  process.exit(1);
}

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const sb = createClient(url, key);

async function main() {
  const { data: tag, error: tagErr } = await sb
    .from("tags")
    .select("id, name")
    .eq("brand_id", brandId)
    .eq("name", tagName)
    .maybeSingle();
  if (tagErr || !tag) throw new Error(`Tag não encontrada: ${tagErr?.message ?? tagName}`);

  const taggedIds: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: tagged, error: tcErr } = await sb
      .from("contact_tags")
      .select("contact_id")
      .eq("tag_id", tag.id)
      .range(from, from + PAGE - 1);
    if (tcErr) throw tcErr;
    const rows = tagged ?? [];
    taggedIds.push(...rows.map((r: any) => r.contact_id));
    if (rows.length < PAGE) break;
  }
  const uniqIds = Array.from(new Set(taggedIds));


  // Filtrar para garantir que pertencem ao brand
  const inBrand = new Set<string>();
  for (let i = 0; i < uniqIds.length; i += 500) {
    const slice = uniqIds.slice(i, i + 500);
    const { data: cs, error } = await sb
      .from("contacts")
      .select("id")
      .eq("brand_id", brandId)
      .in("id", slice);
    if (error) throw error;
    for (const c of cs ?? []) inBrand.add((c as any).id);
  }
  const allContactIds = uniqIds.filter((id) => inBrand.has(id));
  console.log(`Contatos com a tag "${tagName}": ${allContactIds.length}`);


  // Contatos que já têm run para esta automação
  const alreadyRun = new Set<string>();
  for (let i = 0; i < allContactIds.length; i += 500) {
    const slice = allContactIds.slice(i, i + 500);
    const { data: runs, error } = await sb
      .from("automation_runs")
      .select("contact_id")
      .eq("automation_id", automationId)
      .in("contact_id", slice);
    if (error) throw error;
    for (const r of runs ?? []) alreadyRun.add((r as any).contact_id);
  }

  const pending = allContactIds.filter((id) => !alreadyRun.has(id));
  console.log(`Já processados: ${alreadyRun.size} | Pendentes: ${pending.length}`);

  const fnUrl = `${url}/functions/v1/automation-engine`;
  const CONCURRENCY = 6;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((cid) =>
        fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ event: "tag_added", contact_id: cid, tag: tagName }),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        })
      )
    );
    for (const r of results) (r.status === "fulfilled" ? ok++ : fail++);
    if ((i / CONCURRENCY) % 20 === 0) {
      console.log(`Progresso: ${i + batch.length}/${pending.length} (ok=${ok} fail=${fail})`);
    }
  }
  console.log(`\nFinal: ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

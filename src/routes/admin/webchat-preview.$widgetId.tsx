import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type WidgetCfg = {
  id: string;
  display_mode?: "popup" | "inline";
  inline_max_width?: number | null;
  inline_height?: number | null;
  inline_fill_container?: boolean;
  inline_align?: "left" | "center" | "right";
};

export const Route = createFileRoute("/admin/webchat-preview/$widgetId")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Preview do Webchat — MegaCRM" }] }),
  component: WebchatPreviewPage,
});

function WebchatPreviewPage() {
  const { widgetId } = Route.useParams();
  const [cfg, setCfg] = useState<WidgetCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const inlineHostRef = useRef<HTMLDivElement | null>(null);

  // Fetch widget config (use public endpoint so it matches what the embed sees)
  useEffect(() => {
    if (!widgetId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/public/webchat/${widgetId}/config`, { cache: "no-store" });
        const j = (await r.json()) as WidgetCfg;
        if (!cancelled) setCfg(j);
      } catch {
        if (!cancelled) setCfg(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetId]);

  // Inject widget.js with the proper mode/target whenever cfg changes
  useEffect(() => {
    if (!widgetId || !cfg) return;

    // Clean previous instances
    document.querySelectorAll("[data-megacrm-webchat]").forEach((n) => n.remove());
    document.querySelectorAll(`script[data-widget-id="${widgetId}"]`).forEach((n) => n.remove());
    try {
      (window as unknown as { __MEGACRM_WEBCHAT_LOADED__?: boolean }).__MEGACRM_WEBCHAT_LOADED__ = false;
    } catch {
      /* noop */
    }

    const s = document.createElement("script");
    s.src = `/widget.js?w=${widgetId}&t=${Date.now()}`;
    s.async = true;
    s.setAttribute("data-widget-id", widgetId);
    if (cfg.display_mode === "inline") {
      s.setAttribute("data-mode", "inline");
      s.setAttribute("data-target", "#megacrm-webchat-inline-preview");
    }
    document.body.appendChild(s);

    return () => {
      s.remove();
      document.querySelectorAll("[data-megacrm-webchat]").forEach((n) => n.remove());
      try {
        (window as unknown as { __MEGACRM_WEBCHAT_LOADED__?: boolean }).__MEGACRM_WEBCHAT_LOADED__ = false;
      } catch {
        /* noop */
      }
    };
  }, [widgetId, cfg]);

  if (loading) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center bg-muted/30">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const mode = cfg?.display_mode ?? "popup";

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-muted/30 p-8">
      <div className="mx-auto grid max-w-4xl gap-6">
        <div>
          <h1 className="text-xl font-semibold">Preview do Webchat</h1>
          <p className="text-sm text-muted-foreground">
            Visualização ao vivo usando exatamente a mesma configuração que será servida no site
            do cliente.
          </p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 text-[11px]">
            <span className="font-mono text-muted-foreground">Modo:</span>
            <span className="font-medium">{mode === "inline" ? "Inline (embedado)" : "Popup (bolha flutuante)"}</span>
          </div>
        </div>

        {mode === "inline" ? (
          <div className="rounded-lg border border-border bg-background p-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Abaixo é uma simulação da página do cliente. O chat aparece embedado dentro do
              container, com as dimensões e alinhamento que você configurou.
            </p>
            <div className="rounded-md border border-dashed border-border bg-muted/40 p-6">
              <h2 className="mb-2 text-lg font-semibold">Página de exemplo do cliente</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
                incididunt ut labore et dolore magna aliqua.
              </p>
              {/* Inline host — widget.js will mount here */}
              <div
                id="megacrm-webchat-inline-preview"
                ref={inlineHostRef}
                style={{ display: "block", width: "100%", minHeight: 200 }}
              />
              <p className="mt-4 text-sm text-muted-foreground">
                Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip
                ex ea commodo consequat.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
            O widget aparece no canto inferior {cfg?.display_mode === "popup" ? "(conforme posição configurada)" : ""}.
            Use-o para iniciar uma conversa de teste.
          </div>
        )}

        <div className="rounded-md border border-dashed border-border bg-background p-4 text-xs text-muted-foreground">
          Widget ID: <span className="font-mono">{widgetId}</span>
        </div>
      </div>
    </div>
  );
}

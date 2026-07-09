import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";

// Atualiza presença a cada 30s enquanto o usuário está logado e a aba ativa.
export function usePresenceHeartbeat() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const beat = async (status: "online" | "away" | "offline") => {
      if (cancelled) return;
      await supabase.from("agent_presence").upsert({
        user_id: user.id,
        status,
        last_seen_at: new Date().toISOString(),
      });
    };

    beat(document.visibilityState === "visible" ? "online" : "away");
    const interval = setInterval(
      () => beat(document.visibilityState === "visible" ? "online" : "away"),
      30_000
    );
    const onVisibility = () =>
      beat(document.visibilityState === "visible" ? "online" : "away");
    const onUnload = () => {
      // best-effort
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/agent_presence?on_conflict=user_id`,
        new Blob(
          [JSON.stringify({ user_id: user.id, status: "offline", last_seen_at: new Date().toISOString() })],
          { type: "application/json" }
        )
      );
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
      void beat("offline");
    };
  }, [user]);
}

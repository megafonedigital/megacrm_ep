import { supabase } from "@/integrations/supabase/client";

export async function callFunction<T = unknown>(
  name: string,
  body?: unknown,
  init?: { method?: "POST" | "GET"; headers?: Record<string, string> }
): Promise<{ data: T | null; error: { message: string; code?: string; status?: number; details?: string } | null }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: init?.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: body && init?.method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      data: null,
      error: {
        message: json?.error_pt ?? json?.error ?? "Erro de comunicação.",
        code: json?.code,
        status: res.status,
        details: json?.details,
      },
    };
  }
  return { data: json as T, error: null };
}

export async function uploadMedia(file: File, conversationId: string) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("conversation_id", conversationId);
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: fd,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Falha no upload");
  return json as { url: string; path: string; mime: string; filename: string; size: number };
}

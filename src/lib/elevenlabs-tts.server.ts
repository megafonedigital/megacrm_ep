// Server-only helper: ElevenLabs TTS + upload de mídia para WhatsApp Cloud API.

export type VoiceConfig = {
  voice_id: string | null;
  model_id: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
};

export type GenerateTtsOptions = {
  timeoutMs?: number;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (timedOut) throw new Error(`timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateTtsOgg(text: string, voice: VoiceConfig, options: GenerateTtsOptions = {}): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  if (!voice.voice_id) throw new Error("voice_id missing");

  // WhatsApp aceita audio/ogg (Opus). Usamos 32kbps para reduzir latência e
  // evitar que geração + upload estourem o tempo do worker.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}?output_format=opus_48000_32`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/ogg",
    },
    body: JSON.stringify({
      text,
      model_id: voice.model_id || "eleven_multilingual_v2",
      voice_settings: {
        stability: voice.stability ?? 0.5,
        similarity_boost: voice.similarity_boost ?? 0.75,
        style: voice.style ?? 0,
        use_speaker_boost: true,
        speed: voice.speed ?? 1.0,
      },
    }),
  }, options.timeoutMs ?? 18_000);
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`elevenlabs ${res.status}: ${err.slice(0, 300)}`);
  }
  return await res.arrayBuffer();
}

export async function uploadAudioToMeta(args: {
  phoneNumberId: string;
  token: string;
  audio: ArrayBuffer;
  mime?: string;
  filename?: string;
}): Promise<string> {
  const { phoneNumberId, token, audio } = args;
  const mime = args.mime ?? "audio/ogg";
  const filename = args.filename ?? "voice.ogg";

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([audio], { type: mime }), filename);

  const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }, 12_000);
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.id) {
    const msg = json?.error?.message ?? `meta media upload ${res.status}`;
    throw new Error(msg);
  }
  return json.id as string;
}

export async function sendWhatsappAudioByMediaId(args: {
  phoneNumberId: string;
  token: string;
  to: string;
  mediaId: string;
}): Promise<{ ok: boolean; wa_message_id?: string | null; error_code?: string; error_message?: string }> {
  const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.to,
      type: "audio",
      audio: { id: args.mediaId },
    }),
  }, 10_000);
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    return {
      ok: false,
      error_code: String(json?.error?.code ?? `META_${res.status}`),
      error_message: String(json?.error?.message ?? "Falha ao enviar áudio"),
    };
  }
  return { ok: true, wa_message_id: json?.messages?.[0]?.id ?? null };
}

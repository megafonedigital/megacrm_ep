// CORS helpers for the public /api/public/webchat/* endpoints.
// Widgets run on arbitrary 3rd-party domains, so we allow any origin.

export const WEBCHAT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Visitor-Id",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export function webchatJson(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...WEBCHAT_CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function webchatPreflight(): Response {
  return new Response(null, { status: 204, headers: WEBCHAT_CORS_HEADERS });
}

export function webchatError(status: number, code: string, message?: string): Response {
  return webchatJson({ error: code, message: message ?? code }, status);
}

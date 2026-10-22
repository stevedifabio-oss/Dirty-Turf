// Serve the confirmation on our domain. Supabase's shared domain forces HTML
// responses to text/plain. Signature validation and writes remain in Supabase.
import { buildNotificationPreferenceStatus } from "../../supabase/functions/_shared/notification-email.ts";
const endpoint = "https://ipbtldajgsoxixqmajec.supabase.co/functions/v1/academy-notifications/unsubscribe";
const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
// The public edge can override response headers. Set the document policy before
// branded fonts, images or form navigation can carry the signed link as referrer.
const privatePreferenceHtml = (html: string) => html.replace(/<head>/i, '<head><meta name="referrer" content="no-referrer">');
const failure = (status: number) => new Response(privatePreferenceHtml(buildNotificationPreferenceStatus("Email preferences could not be opened", "Use the link in your latest email, or open notification settings in the Academy.")), { status, headers });

export default async function unsubscribe(request: Request) {
  if (!["GET", "POST"].includes(request.method)) return failure(405);
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin && origin !== url.origin) return failure(403);
  let token = url.searchParams.get("token") ?? "";
  if (request.method === "POST" && !token) {
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return failure(415);
    const reader = request.body?.getReader();
    if (!reader) return failure(400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return failure(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    token = new URLSearchParams(new TextDecoder().decode(bytes)).get("token") ?? "";
  }
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return failure(400);
  const target = new URL(endpoint);
  target.searchParams.set("token", token);
  try {
    const response = await fetch(target, {
      method: request.method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();
    if (!html.toLowerCase().startsWith("<!doctype html>") || !/<head>/i.test(html) || html.length > 32_768) return failure(503);
    return new Response(privatePreferenceHtml(html), { status: response.status, headers });
  } catch {
    return failure(503);
  }
}

export const config = { path: "/email/unsubscribe" };

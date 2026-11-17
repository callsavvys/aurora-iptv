// shared by the relays: a public http(s) URL or null, and a plain refusal
export function publicUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (/^(localhost|127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|::1$)/i.test(url.hostname)) return null;
  return url;
}
export const refuse = (status, text) => new Response(text, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

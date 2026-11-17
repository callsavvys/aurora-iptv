/* The web site's video relay (Cloudflare Pages Function).

   The provider serves video over plain http, and a page served over https may
   not play http:// video, so the site passes it on: films and episodes as
   they are (seeking works, the Range header goes through), live channels as
   HLS with every playlist rewritten so its segments come back through here.

   Only media is relayed: Xtream stream paths (/live/, /movie/, /series/,
   /timeshift/), HLS playlists and segments, and video files by extension.
   Nothing is logged: stream URLs carry the account's login. */
import { publicUrl, refuse } from "./_relay.js";

const MEDIA = /(^\/(live|movie|series|timeshift)\/)|\.(m3u8|ts|m4s|mp4|m4v|mkv|webm|mov|avi|aac|mp3|vtt|key)$/i;

export async function onRequestGet({ request }) {
  const self = new URL(request.url);
  const url = publicUrl(self.searchParams.get("u"));
  if (!url) return refuse(400, "not a public http(s) url");
  if (!MEDIA.test(url.pathname)) return refuse(403, "only video is relayed here");
  const headers = { "user-agent": "Aurora-IPTV/web" };
  const range = request.headers.get("range");
  if (range) headers.range = range;
  let upstream;
  try { upstream = await fetch(url.toString(), { headers, redirect: "follow" }); }
  catch { return refuse(502, "The provider did not answer"); }

  const type = upstream.headers.get("content-type") || "";
  const finalUrl = upstream.url || url.toString();
  const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(finalUrl).pathname);
  if (isPlaylist && upstream.ok) {
    const text = await upstream.text();
    return new Response(rewrite(text, finalUrl, self.origin), {
      status: 200, headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
    });
  }
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h); if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* Every URI in a playlist (segment and variant lines, URI="..." in tags),
   made absolute against where the playlist really came from, then sent back
   through this relay. */
function rewrite(text, base, origin) {
  const through = (ref) => {
    try { return `${origin}/api/stream?u=${encodeURIComponent(new URL(ref, base).toString())}`; } catch { return ref; }
  };
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${through(ref)}"`);
    return through(t);
  }).join("\n");
}

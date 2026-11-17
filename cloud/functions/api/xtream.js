/* The web site's relay for an IPTV provider's catalogue (Cloudflare Pages
   Function). A browser page cannot read a provider's catalogue (the provider
   sends no CORS headers), so this forwards exactly the Xtream catalogue API,
   `.../player_api.php?...`, and nothing else. Nothing is logged: the URL
   carries the account's login. Video goes through /api/stream. */
import { publicUrl, refuse } from "./_relay.js";

export async function onRequestGet({ request }) {
  const url = publicUrl(new URL(request.url).searchParams.get("u"));
  if (!url) return refuse(400, "not a public http(s) url");
  if (!/\/player_api\.php$/.test(url.pathname)) return refuse(403, "only the provider's catalogue is relayed here");
  let upstream;
  try { upstream = await fetch(url.toString(), { headers: { "user-agent": "Aurora-IPTV/web" }, redirect: "follow" }); }
  catch { return refuse(502, "The provider did not answer"); }
  return new Response(upstream.body, { status: upstream.status, headers: { "cache-control": "no-store", "content-type": upstream.headers.get("content-type") || "application/json" } });
}

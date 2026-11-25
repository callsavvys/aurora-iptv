import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getLine, setLine, testLine, lineLabel, savePlaylistFile } from "./line.js";
import { AuroraMark } from "./icons.jsx";
import Player from "./Player.jsx";
import { relay, pickedSource } from "./platform.js";
import { saveSource } from "./vault.js";

/* Connect a source: right after you sign up (?first=1, full screen, with
   "Set up later"), and from Settings → Account. Aurora plays from what you
   bring:
   - an Xtream Codes login or an M3U playlist (a link or a file) becomes your
     source: Play on every title looks for it there, and Live TV lists its
     channels;
   - a single stream link or a video or audio file on this computer plays
     straight away (links are remembered here; files are not kept). */

const INPUT = "w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50";
const LABEL = "mb-1 block text-xs font-medium text-white/50";
const PRIMARY = "w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50";
const STREAMS = "aurora-site-streams";
const ic = (children) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const KINDS = [
  ["xtream", "Xtream Codes", "A server address, a username and a password from your provider.", ic(<><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path d="M6 6h.01M6 18h.01" /></>)],
  ["m3u", "M3U playlist", "A playlist link (.m3u or .m3u8), or a playlist file on this computer.", ic(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>)],
  ["stream", "Single stream", "One link to a channel or a video: HLS (.m3u8), MP4 and the like.", ic(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>)],
  ["files", "Local files", "Video and audio files on this computer. Nothing is uploaded.", ic(<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m10 11 5 3-5 3Z" /></>)],
];
const readStreams = () => { try { return JSON.parse(localStorage.getItem(STREAMS) || "[]"); } catch { return []; } };
const writeStreams = (list) => { try { localStorage.setItem(STREAMS, JSON.stringify(list.slice(0, 20))); } catch { /* private mode */ } };
const field = (form, setForm, k, label, type = "text", auto = "off", placeholder = "") => (
  <div><label className={LABEL}>{label}</label><input type={type} autoComplete={auto} spellCheck="false" placeholder={placeholder} className={INPUT} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
);

function XtreamForm({ onSaved }) {
  const saved = getLine()?.kind !== "m3u" ? getLine() : null;
  const [form, setForm] = useState({ name: saved?.name || "My IPTV", server: saved?.server || "", username: saved?.username || "", password: saved?.password || "" });
  const [state, setState] = useState({ busy: false, error: "" });
  const go = async (e) => {
    e.preventDefault();
    if (!form.server || !form.username || !form.password) return setState({ busy: false, error: "Server, username and password are all needed." });
    setState({ busy: true, error: "" });
    try {
      await testLine({ kind: "xtream", ...form }); setLine({ kind: "xtream", ...form });
      // kept on your account too (sealed), so your other devices list it
      const kept = await saveSource(form).catch(() => false);
      pickedSource();
      onSaved(`Connected to ${form.name || "your line"}.${kept ? " Saved to your account." : ""}`);
    }
    catch (err) { setState({ busy: false, error: err.message || "Could not connect." }); }
  };
  return (
    <form className="space-y-3" onSubmit={go}>
      {field(form, setForm, "name", "Name")}
      {field(form, setForm, "server", "Server address", "text", "off", "http://example.com:8080")}
      <div className="grid grid-cols-2 gap-3">{field(form, setForm, "username", "Username", "text", "username")}{field(form, setForm, "password", "Password", "password", "current-password")}</div>
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      <button type="submit" disabled={state.busy} className={PRIMARY}>{state.busy ? "Connecting..." : "Connect"}</button>
    </form>
  );
}

function M3uForm({ onSaved }) {
  const saved = getLine()?.kind === "m3u" ? getLine() : null;
  const [form, setForm] = useState({ name: saved?.name || "My playlist", url: saved?.url || "" });
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const pick = useRef(null);
  const go = async (e) => {
    e.preventDefault();
    if (!form.url && !file) return setState({ busy: false, error: "Paste a playlist link or pick a playlist file." });
    setState({ busy: true, error: "" });
    try {
      let cfg;
      const text = file ? await file.text() : "";
      cfg = file ? { kind: "m3u", name: form.name, file: file.name } : { kind: "m3u", name: form.name, url: form.url.trim() };
      const n = await testLine(file ? { ...cfg, text } : cfg);
      if (file) await savePlaylistFile(text);   // kept only once it reads as a playlist
      setLine(cfg);
      onSaved(`Connected to ${form.name || "your playlist"}: ${n.live} channels, ${n.movies} films, ${n.series} series.`);
    } catch (err) { setState({ busy: false, error: err.message || "Could not read the playlist." }); }
  };
  return (
    <form className="space-y-3" onSubmit={go}>
      {field(form, setForm, "name", "Name")}
      {file ? null : field(form, setForm, "url", "Playlist link", "url", "off", "http://example.com/get.php?…&type=m3u_plus")}
      <div className="flex items-center gap-3 text-xs text-white/30"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>
      <input ref={pick} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button type="button" onClick={() => pick.current?.click()} className="w-full rounded-lg border border-white/10 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-atlantic-400/40 hover:text-white">{file ? `File: ${file.name}` : "Pick a playlist file"}</button>
      {file ? <button type="button" onClick={() => { setFile(null); if (pick.current) pick.current.value = ""; }} className="text-xs text-white/50 hover:text-white">Use a link instead</button> : null}
      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      <button type="submit" disabled={state.busy} className={PRIMARY}>{state.busy ? "Reading the playlist..." : "Connect"}</button>
    </form>
  );
}

function StreamForm({ play }) {
  const [form, setForm] = useState({ name: "", url: "" });
  const [list, setList] = useState(readStreams);
  const [error, setError] = useState("");
  const go = (e) => {
    e.preventDefault();
    let url;
    try { url = new URL(form.url.trim()); } catch { setError("Paste a full link, starting with http:// or https://."); return; }
    if (!/^https?:$/.test(url.protocol)) { setError("Paste a full link, starting with http:// or https://."); return; }
    const s = { name: form.name.trim() || url.pathname.split("/").pop() || url.host, url: url.toString() };
    const next = [s, ...list.filter((x) => x.url !== s.url)];
    setList(next); writeStreams(next); setError("");
    play({ src: relay(s.url), title: s.name, live: "auto" });
  };
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={go}>
        {field(form, setForm, "url", "Stream link", "url", "off", "https://example.com/live/stream.m3u8")}
        {field(form, setForm, "name", "Name (optional)")}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" className={PRIMARY}>Play</button>
      </form>
      {list.length ? (
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/45">Your links</p>
          <div className="space-y-2">{list.map((s) => (
            <div key={s.url} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{s.name}</p><p className="truncate text-xs text-white/40">{s.url.replace(/\/\/[^/@]*@/, "//")}</p></div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => play({ src: relay(s.url), title: s.name, live: "auto" })} className="rounded-lg bg-atlantic-500 px-3 py-1.5 text-xs font-bold text-abyss-950 hover:bg-atlantic-400">Play</button>
                <button type="button" onClick={() => { const next = list.filter((x) => x.url !== s.url); setList(next); writeStreams(next); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 hover:border-red-500/40 hover:text-red-300">Remove</button>
              </div>
            </div>
          ))}</div>
        </div>
      ) : null}
    </div>
  );
}

function FilesForm({ play }) {
  const [files, setFiles] = useState([]);
  const pick = useRef(null);
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), [files]);
  return (
    <div className="space-y-3">
      <input ref={pick} type="file" multiple accept="video/*,audio/*,.mkv" className="hidden" onChange={(e) => setFiles([...(e.target.files || [])].map((f) => ({ name: f.name, size: f.size, url: URL.createObjectURL(f), audio: f.type.startsWith("audio/") })))} />
      <button type="button" onClick={() => pick.current?.click()} className={PRIMARY}>Pick video or audio files</button>
      <p className="text-xs text-white/40">They play from this computer. Nothing is uploaded, and they are not kept after you leave.</p>
      {files.length ? <div className="space-y-2">{files.map((f, i) => (
        <div key={f.url} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{f.name}</p><p className="text-xs text-white/40">{f.audio ? "Audio" : "Video"} · {(f.size / 1048576).toFixed(f.size > 1048576 * 100 ? 0 : 1)} MB</p></div>
          <button type="button" onClick={() => play({ src: f.url, title: f.name.replace(/\.[^.]+$/, ""), queue: files, at: i })} className="shrink-0 rounded-lg bg-atlantic-500 px-3 py-1.5 text-xs font-bold text-abyss-950 hover:bg-atlantic-400">Play</button>
        </div>
      ))}</div> : null}
    </div>
  );
}

export default function Sources() {
  const [search] = useSearchParams();
  const first = search.get("first") === "1";
  const nav = useNavigate();
  const [kind, setKind] = useState(() => (getLine()?.kind === "m3u" ? "m3u" : "xtream"));
  const [done, setDone] = useState("");
  const [player, setPlayer] = useState(null);
  const current = getLine();
  useEffect(() => { document.title = "Connect a source — Aurora"; }, []);
  const saved = (msg) => { pickedSource(); setDone(msg); if (first) setTimeout(() => nav("/", { replace: true }), 900); };
  const later = () => { try { localStorage.setItem("aurora-site-source-later", "1"); } catch { /* private mode */ } nav("/", { replace: true }); };
  const playFile = (p) => setPlayer({ ...p, key: p.src });
  // local files play one after another
  const after = player?.queue?.[player.at + 1];
  const next = after ? () => playFile({ src: after.url, title: after.name.replace(/\.[^.]+$/, ""), queue: player.queue, at: player.at + 1 }) : null;
  const body = (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-3xl font-bold text-white sm:text-4xl">Connect a source</h1>
      <p className="mt-2 text-sm text-white/50">{current ? `Now: ${lineLabel(current)}. Pick another to change it.` : "Pick what you watch from. You can change it any time in Settings."}</p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {KINDS.map(([id, label, line, icon]) => (
          <button key={id} type="button" onClick={() => { setKind(id); setDone(""); }} className={`flex flex-col gap-3 rounded-2xl border p-4 text-left transition-colors ${kind === id ? "border-atlantic-400 bg-white/[0.08]" : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]"}`}>
            <span className={kind === id ? "text-atlantic-300" : "text-white/70"}>{icon}</span>
            <span><span className="block text-sm font-semibold text-white">{label}</span><span className="mt-1 block text-xs text-white/45">{line}</span></span>
          </button>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-white/10 bg-abyss-900/60 p-5">
        {done ? <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-4"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /><p className="text-sm text-white">{done}</p>{first ? null : <Link to="/" className="ml-auto shrink-0 rounded-lg bg-atlantic-500 px-4 py-2 text-sm font-bold text-abyss-950 hover:bg-atlantic-400">Start watching</Link>}</div>
          : kind === "xtream" ? <XtreamForm onSaved={saved} />
            : kind === "m3u" ? <M3uForm onSaved={saved} />
              : kind === "stream" ? <StreamForm play={playFile} />
                : <FilesForm play={playFile} />}
        {kind === "xtream" || kind === "m3u" ? <p className="mt-3 text-xs text-white/40">Kept in this browser only, and sent only to your provider.</p> : null}
      </div>
      {first ? <div className="mt-6 text-center"><button type="button" onClick={later} className="text-sm text-white/50 hover:text-white">Set up later</button></div> : null}
    </div>
  );
  return (
    <>
      {first ? (
        <div className="min-h-dvh w-full bg-black/40">
          <header className="flex items-center gap-3 px-6 py-5 sm:px-12"><AuroraMark size={44} /><span className="text-2xl font-bold tracking-tight text-white">Aurora</span><span className="ml-auto text-xs font-semibold uppercase tracking-wider text-white/40">Step 2 of 2</span></header>
          <div className="px-4 pb-16 pt-6 sm:px-6">{body}</div>
        </div>
      ) : <div className="px-4 pb-20 pt-32 sm:px-6">{body}</div>}
      {player ? <Player key={player.key} src={player.src} title={player.title} live={player.live || false} onClose={() => setPlayer(null)} onNext={next || undefined} onEnded={next || undefined} /> : null}
    </>
  );
}

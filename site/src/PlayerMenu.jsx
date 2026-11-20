import { useRef, useState } from "react";
import { FONTS as FONT_FAMILIES } from "./subs.js";
import { flagOf } from "./extras.js";
import { PartyPanel } from "./PartyUI.jsx";
import { useParty } from "./party.js";
import "flag-icons/css/flag-icons.min.css";

/* The player's settings panel, in atlantic.bz's markup (captured from its
   /watch page): quality, server, subtitles and audio tiles; Watch Party;
   Enable Subtitles; Playback Settings; Subtitle Settings. The Download row
   is left out, as on the rest of Aurora. */

const L = (cls, children) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide ${cls}`} aria-hidden="true">{children}</svg>;
const I = {
  server: L("lucide-server size-3.5 stroke-[2.5] text-white/80", <><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></>),
  captions: (c) => L(`lucide-captions lucide-subtitles ${c}`, <><rect width="18" height="14" x="3" y="5" rx="2" ry="2" /><path d="M7 15h4M15 15h2M7 11h2M13 11h4" /></>),
  volume: (c) => L(`lucide-volume-2 ${c}`, <><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></>),
  users: L("lucide-users size-4.5 stroke-[2.5] text-white/90", <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></>),
  gauge: L("lucide-gauge size-4.5 stroke-[2.5] text-white/90", <><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>),
  type: L("lucide-type size-4.5 stroke-[2.5] text-white/90", <><path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" /></>),
  right: (c = "size-4 stroke-[2.5] text-white/60") => L(`lucide-chevron-right ${c}`, <path d="m9 18 6-6-6-6" />),
  left: (c = "size-4 shrink-0 stroke-[2.5]") => L(`lucide-chevron-left ${c}`, <path d="m15 18-6-6 6-6" />),
  check: L("lucide-check size-4 shrink-0 stroke-[3]", <path d="M20 6 9 17l-5-5" />),
  sliders: L("lucide-sliders-horizontal size-3.5 stroke-[2.5]", <><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></>),
  upload: L("lucide-upload size-4 stroke-[2.5]", <><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></>),
  paste: L("lucide-clipboard-paste size-4 stroke-[2.5]", <><path d="M11 14h10" /><path d="M16 4h2a2 2 0 0 1 2 2v1.344" /><path d="m17 18 4-4-4-4" /><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" /><rect x="8" y="2" width="8" height="4" rx="1" /></>),
  sun: L("lucide-sun size-4.5 shrink-0 stroke-[2.5] text-white/90", <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>),
  contrast: L("lucide-contrast size-4.5 shrink-0 stroke-[2.5] text-white/90", <><circle cx="12" cy="12" r="10" /><path d="M12 18a6 6 0 0 0 0-12v12z" /></>),
  palette: (c, style) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-palette ${c}`} aria-hidden="true" style={style}><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg>,
  sparkles: L("lucide-sparkles lucide-stars size-4", <><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" /></>),
  reset: L("lucide-rotate-ccw size-3 stroke-[2.5]", <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>),
  swatch: L("lucide-check size-3.5 stroke-[3] text-black", <path d="M20 6 9 17l-5-5" />),
};

const ROW = "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-label-md font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.99]";
const TILE = "pm-accent-hover group flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.06] p-3 text-left transition-all hover:border-white/25 hover:bg-white/[0.1] active:scale-[0.98]";
const TILE_OFF = "group flex cursor-not-allowed flex-col justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left opacity-40 pointer-events-none";
const TILE_HEAD = "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50 group-hover:text-white/75";
const SEG_ON = "bg-primary text-on-primary font-bold shadow-sm ";
const SEG_OFF = "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white ";

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-200 cursor-pointer select-none ${on ? "border-[var(--pm-primary-50)] bg-primary" : "border-white/15 bg-white/10"}`}>
      <span className={`block size-5 rounded-full shadow-sm transition-transform duration-200 ease-out pointer-events-none ${on ? "translate-x-5 bg-on-primary" : "translate-x-0 bg-white/70"}`} />
    </button>
  );
}

/* a dragged slider, 0…1 */
function Slider({ value, onChange, centred, inline }) {
  const track = useRef(null);
  const at = (ev) => { const r = track.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
  const down = (ev) => { ev.preventDefault(); onChange(at(ev)); const move = (e) => onChange(at(e)); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); };
  const pct = `${value * 100}%`;
  return (
    <div className={`group/slider relative flex h-7 ${inline ? "flex-1" : "w-full"} cursor-pointer touch-none select-none items-center px-2 py-2`} onPointerDown={down}>
      <div ref={track} dir="ltr" className="relative h-1 w-full rounded-full bg-white/20 transition-[height] duration-100 group-hover/slider:h-1.5 ">
        {centred ? <>
          <div className="absolute left-1/2 top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" aria-hidden="true" />
          <div className="absolute top-0 h-full rounded-full bg-primary transition-[left,width] duration-75" style={{ left: `${Math.min(50, value * 100)}%`, width: `${Math.abs(value * 100 - 50)}%` }} />
          <div className="absolute top-1/2 size-4 min-w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3.5px] border-[var(--pm-primary-50)] bg-white shadow-[0_0_8px_var(--pm-primary)] transition-[transform,left] duration-100 group-hover/slider:scale-110" style={{ left: pct }} />
        </> : (
          <div className="absolute left-0 top-0 flex h-full items-center justify-end rounded-full bg-primary transition-[width] duration-75" style={{ width: pct }}>
            <div className="size-4 min-w-4 rounded-full border-[3.5px] border-[var(--pm-primary-50)] bg-white shadow-[0_0_8px_var(--pm-primary)] transition-[transform] duration-100 transform translate-x-1/2 group-hover/slider:scale-110" />
          </div>
        )}
      </div>
    </div>
  );
}

const Back = ({ label, onClick }) => <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-label-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.99]">{I.left()}<span className="line-clamp-1 break-all">{label}</span></button>;
const Choice = ({ label, on, onClick }) => (
  <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-label-md transition-all ${on ? "bg-primary text-on-primary font-bold shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white active:scale-[0.99]"}`}>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>{on ? <span className="ml-2 flex shrink-0 items-center gap-2">{I.check}</span> : null}
  </button>
);
const Rule = ({ m = "my-1" }) => <div className={`${m} h-px bg-white/10`} />;

/* a percentage control: icon, slider, ‹ value › */
function Level({ label, icon, value, min, max, onChange }) {
  const set = (v) => onChange(Math.round(Math.max(min, Math.min(max, v))));
  return (
    <div className="px-0.5"><div className="space-y-1.5">
      <span className="text-xs font-bold text-white/90">{label}</span>
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
        {icon}
        <Slider inline value={(value - min) / (max - min)} onChange={(f) => set(min + f * (max - min))} />
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg bg-white/10">
          <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - 10)} className="px-2 py-1.5 text-white/80 transition hover:text-white active:scale-95">{I.left("size-3.5 stroke-[2.5]")}</button>
          <button type="button" title="Click to type exact value" className="w-14 py-1 text-center text-xs font-bold text-white tabular-nums transition hover:bg-white/10">{value}%</button>
          <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + 10)} className="px-2 py-1.5 text-white/80 transition hover:text-white active:scale-95">{I.right("size-3.5 stroke-[2.5]")}</button>
        </div>
      </div>
    </div></div>
  );
}

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
export const PICTURES = ["Fit", "Fill", "Stretch", "16:9", "4:3", "21:9"];
const FONTS = Object.keys(FONT_FAMILIES);
const COLORS = ["#ffffff", "#80b1fa", "#e2e535", "#10B239"];

export default function PlayerMenu({ view, setView, prefs, setPref, resetSubs, quality, server, subs, audio, party, live }) {
  const file = useRef(null);
  const [paste, setPaste] = useState("");
  const partyRole = useParty((p) => p.role);
  const inParty = useParty((p) => p.phase === "in" || p.phase === "reconnecting");
  const subLabel = subs.current ? (subs.tracks.find((t) => t.id === subs.current)?.label || "On") : "Off";
  let body;
  if (view === "quality") {
    body = (
      <div className="flex flex-col gap-1">
        <Back label="Quality" onClick={() => setView("main")} /><Rule />
        {quality.levels.map((q) => <Choice key={q.id} label={q.label} on={!quality.auto && quality.current === q.id} onClick={() => quality.choose(q.id)} />)}
        <Rule />
        <div className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-label-md text-white/85"><span>Automatic quality</span><Switch on={quality.auto} onChange={quality.setAuto} /></div>
        <p className="mt-2 px-3 text-[11px] font-medium leading-relaxed text-white/50">Automatic quality adapts to your connection speed. Missing a resolution? Try another <button type="button" className="text-atlantic-300" onClick={() => setView("server")}>server</button>.</p>
      </div>
    );
  } else if (view === "server") {
    body = <div className="flex flex-col gap-1"><Back label="Server" onClick={() => setView("main")} /><Rule /><Choice label={server} on onClick={() => setView("main")} /><p className="mt-2 px-3 text-[11px] font-medium leading-relaxed text-white/50">Aurora plays from your own IPTV line.</p></div>;
  } else if (view === "audio") {
    body = <div className="flex flex-col gap-1"><Back label="Audio" onClick={() => setView("main")} /><Rule />{audio.tracks.map((a) => <Choice key={a.id} label={a.label} on={audio.current === a.id} onClick={() => audio.choose(a.id)} />)}</div>;
  } else if (view === "paste") {
    body = (
      <div className="flex flex-col gap-1">
        <Back label="Paste subtitle text" onClick={() => setView("subtitles")} /><Rule />
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={7} placeholder="Paste .srt or .vtt text here" className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/90 outline-none placeholder:text-white/30 focus:border-primary" />
        <button type="button" disabled={!paste.trim()} onClick={() => { subs.paste(paste); setPaste(""); setView("subtitles"); }} className="mt-1 w-full rounded-xl py-2.5 text-center text-sm font-bold transition-all active:scale-[0.99] bg-primary text-on-primary hover:brightness-110 disabled:opacity-40">Use these subtitles</button>
      </div>
    );
  } else if (view.startsWith("lang:")) {
    const lang = (subs.online || []).find((l) => l.name === view.slice(5));
    body = (
      <div className="flex flex-col gap-1">
        <Back label={lang?.name || "Subtitles"} onClick={() => setView("subtitles")} /><Rule />
        {(lang?.files || []).map((f) => <Choice key={f.id} label={f.name} on={subs.chosenOnline === f.id} onClick={() => subs.pickOnline(lang, f)} />)}
      </div>
    );
  } else if (view === "subtitles") {
    body = (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1"><Back label="Subtitles" onClick={() => setView("main")} /><button type="button" onClick={() => setView("subset")} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 transition-all hover:bg-white/20">{I.sliders}Customize</button></div>
        <Rule />
        <div className="flex flex-col gap-1">
          <Choice label="Off" on={!subs.current} onClick={() => subs.choose(null)} />
          <Choice label="Auto select" on={false} onClick={() => subs.choose("auto")} />
          <button type="button" onClick={() => file.current?.click()} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-label-md font-semibold text-white/90 transition-colors active:scale-[0.99] hover:bg-white/10 hover:text-white"><div className="flex items-center gap-3">{I.upload}<div className="flex flex-col text-left"><span>Upload subtitle file</span></div></div>{I.right("size-4 shrink-0 stroke-[2.5] text-white/60")}</button>
          <input ref={file} type="file" accept=".srt,.vtt,.ass,.ssa,.sub,.sbv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subs.upload(f); e.target.value = ""; }} />
          <button type="button" onClick={() => setView("paste")} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-label-md font-semibold text-white/90 transition-colors active:scale-[0.99] hover:bg-white/10 hover:text-white"><div className="flex items-center gap-3">{I.paste}<div className="flex flex-col text-left"><span>Paste subtitle text</span></div></div>{I.right("size-4 shrink-0 stroke-[2.5] text-white/60")}</button>
          <div className="h-1" />
          {subs.tracks.map((t) => (
            <button key={t.id} type="button" onClick={() => subs.choose(t.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-label-md font-semibold transition-colors active:scale-[0.99] ${subs.current === t.id ? "bg-primary text-on-primary" : "text-white/90 hover:bg-white/10 hover:text-white"}`}>
              <div className="flex items-center gap-3"><div className="flex flex-col text-left"><span>{t.label}</span></div></div>
              {subs.current === t.id ? I.check : null}
            </button>
          ))}
          {(subs.online || []).map((l) => (
            <button key={l.name} type="button" onClick={() => setView(`lang:${l.name}`)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-label-md font-semibold text-white/90 transition-colors active:scale-[0.99] hover:bg-white/10 hover:text-white">
              <div className="flex items-center gap-3"><span className={`!w-8 min-w-8 h-6 rounded overflow-hidden bg-cover bg-center block fi bg-white/10 fi-${flagOf(l.iso)}`} /><div className="flex flex-col text-left"><span>{l.name}</span></div></div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/50">{l.files.length}</span>
            </button>
          ))}
          {subs.online === null ? <p className="px-3 py-2 text-[11px] font-medium leading-relaxed text-white/50">Looking up subtitles…</p>
            : !subs.tracks.length && !subs.online.length ? <p className="px-3 py-2 text-[11px] font-medium leading-relaxed text-white/50">No subtitles found for this title. Upload or paste a subtitle file.</p> : null}
        </div>
      </div>
    );
  } else if (view === "party") {
    body = (
      <div className="flex flex-col gap-1">
        <Back label="Watch Party" onClick={() => setView("main")} /><Rule />
        <PartyPanel getHostPayload={party.getHostPayload} onClose={() => setView(null)} />
      </div>
    );
  } else if (view === "playback") {
    body = (
      <div className="flex flex-col gap-3.5 select-none text-white">
        <div className="flex items-center justify-between px-1"><button type="button" onClick={() => setView("main")} className="flex items-center gap-1.5 rounded-xl px-2 py-1 text-label-md font-bold text-white/90 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.99]">{I.left("size-4 stroke-[2.5]")}<span>Settings</span></button></div>
        <div className="h-px w-full bg-white/10" />
        {live ? null : <div className="space-y-1.5 px-0.5"><label className="text-xs font-bold text-white/90">Playback speed</label><div className="flex items-center rounded-xl bg-white/[0.06] p-1 gap-1">{SPEEDS.map((s) => <button key={s} type="button" title="Double-click to type an exact speed" onClick={() => setPref("speed", s)} className={`flex-1 py-1.5 rounded-lg text-xs transition-colors text-center ${prefs.speed === s ? "bg-primary text-on-primary font-bold shadow-sm " : "text-white/60 hover:text-white font-semibold "}`}>{s}x</button>)}</div></div>}
        <div className="space-y-1.5 px-0.5"><label className="text-xs font-bold text-white/90">Picture</label><div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(3, minmax(0px, 1fr))" }}>{PICTURES.map((p) => <button key={p} type="button" onClick={() => setPref("picture", p)} className={`rounded-xl py-2 text-center text-xs font-semibold transition-all ${prefs.picture === p ? SEG_ON : SEG_OFF}`}>{p}</button>)}</div></div>
        <div className="flex items-center justify-between rounded-xl px-1 py-1"><div className="flex flex-col pr-3"><span className="text-xs font-bold text-white/90">Remove black bars</span><span className="text-[11px] font-medium text-white/50">Zoom out borders baked into the video</span></div><Switch on={prefs.noBars} onChange={(v) => setPref("noBars", v)} label="Remove black bars" /></div>
        <Level label="Volume booster" icon={I.volume("size-4.5 shrink-0 stroke-[2.5] text-white/90")} value={prefs.boost} min={100} max={300} onChange={(v) => setPref("boost", v)} />
        <Level label="Brightness" icon={I.sun} value={prefs.brightness} min={0} max={200} onChange={(v) => setPref("brightness", v)} />
        <Level label="Contrast" icon={I.contrast} value={prefs.contrast} min={0} max={200} onChange={(v) => setPref("contrast", v)} />
        <Level label="Color" icon={I.palette("size-4.5 shrink-0 stroke-[2.5] text-white/90")} value={prefs.color} min={0} max={200} onChange={(v) => setPref("color", v)} />
        {live ? null : <div className="flex items-center justify-between rounded-xl px-1 py-1"><div className="flex flex-col pr-3"><span className="text-xs font-bold text-white/90">Autoplay Next</span><span className="text-[11px] font-medium text-white/50">Play subsequent episode automatically</span></div><Switch on={prefs.autoplayNext} onChange={(v) => setPref("autoplayNext", v)} label="Autoplay Next" /></div>}
      </div>
    );
  } else if (view === "subset") {
    const delay = prefs.delay;
    body = (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1"><Back label="Subtitle settings" onClick={() => setView("subtitles")} /><button type="button" onClick={resetSubs} className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/50 transition-colors hover:bg-white/15 hover:text-white/90">{I.reset}<span>Reset</span></button></div>
        <Rule />
        <div className="flex flex-col gap-3.5 pb-1">
          <div className="flex items-center justify-between rounded-xl px-3 py-2"><span className="text-sm font-bold text-white/90">Use native subtitles</span><Switch on={prefs.native} onChange={(v) => setPref("native", v)} /></div>
          <div className="flex flex-col items-center gap-2 select-none">
            <span className="self-start text-sm font-bold text-white/90">Subtitle delay</span>
            <div className="w-full"><div className="flex flex-col gap-2 select-none"><Slider centred value={(delay + 10) / 20} onChange={(f) => setPref("delay", Math.round((f * 20 - 10) * 10) / 10)} /></div>
              <div className="flex items-center justify-between px-2 text-[11px] font-semibold tabular-nums text-white/40"><span>-10s</span><button type="button" disabled={delay === 0} onClick={() => setPref("delay", 0)} className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-white/10 hover:text-white/80 disabled:pointer-events-none">0s</button><span>+10s</span></div></div>
            <div className="flex items-center justify-center gap-2.5">
              <button type="button" aria-label="Decrease delay" disabled={delay <= -10} onClick={() => setPref("delay", Math.max(-10, Math.round((delay - 0.1) * 10) / 10))} className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30">{I.left("size-4 stroke-[2.5]")}</button>
              <label className="flex h-9 w-28 cursor-text items-center justify-center gap-1 rounded-xl border-2 bg-black/50 px-2 transition-colors border-white/25 hover:border-white/50"><input type="text" inputMode="decimal" aria-label="Subtitle delay" className="w-12 min-w-0 bg-transparent text-center text-sm font-bold text-white tabular-nums outline-none" value={delay.toFixed(1)} onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setPref("delay", Math.max(-10, Math.min(10, v))); }} /><span className="text-sm font-bold text-white/50">s</span></label>
              <button type="button" aria-label="Increase delay" disabled={delay >= 10} onClick={() => setPref("delay", Math.min(10, Math.round((delay + 0.1) * 10) / 10))} className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30">{I.right("size-4 stroke-[2.5]")}</button>
            </div>
          </div>
          <div className="h-px w-full bg-white/10" />
          <div className="flex flex-col gap-2 select-none"><div className="flex items-center justify-between"><span className="text-sm font-bold text-white/90">Text size</span><button type="button" title="Click to type exact value" className="rounded-lg px-2 py-0.5 text-sm font-bold text-white/80 tabular-nums transition-colors hover:bg-white/15 hover:text-white">{prefs.size}px</button></div><Slider value={(prefs.size - 14) / 26} onChange={(f) => setPref("size", Math.round(14 + f * 26))} /></div>
          <div className="flex flex-col gap-2 select-none"><div className="flex items-center justify-between"><span className="text-sm font-bold text-white/90">Background blur</span><button type="button" title="Click to type exact value" className="rounded-lg px-2 py-0.5 text-sm font-bold text-white/80 tabular-nums transition-colors hover:bg-white/15 hover:text-white">{prefs.blur}px</button></div><Slider value={prefs.blur / 20} onChange={(f) => setPref("blur", Math.round(f * 20))} /></div>
          <div className="h-px w-full bg-white/10" />
          <div className="flex flex-col gap-2"><span className="text-xs font-bold text-white/90">Font style</span><div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(3, minmax(0px, 1fr))" }}>{FONTS.map((f) => <button key={f} type="button" onClick={() => setPref("font", f)} className={`rounded-xl py-2 text-center text-xs font-semibold transition-all ${prefs.font === f ? SEG_ON : SEG_OFF}`}>{f}</button>)}</div></div>
          <div className="flex items-center justify-between rounded-xl px-3 py-2"><span className="text-sm font-bold text-white/90">Text color</span><div className="flex items-center gap-2">
            {COLORS.map((c) => <button key={c} type="button" title={c} onClick={() => setPref("textColor", c)} className={`grid size-7 place-items-center rounded-full transition-transform active:scale-95 ${prefs.textColor.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-2 ring-offset-black" : "opacity-80 hover:scale-105"}`} style={{ backgroundColor: c }}>{prefs.textColor.toLowerCase() === c.toLowerCase() ? I.swatch : null}</button>)}
            <div className="relative inline-flex items-center"><input type="color" className="absolute inset-0 size-7 cursor-pointer opacity-0" title="Pick custom color" value={prefs.textColor} onChange={(e) => setPref("textColor", e.target.value)} /><div className="grid size-7 place-items-center rounded-full border-2 bg-white/10 text-white/90" style={{ borderColor: prefs.textColor }}>{I.palette("size-3.5 stroke-[2.5]", { color: prefs.textColor })}</div></div>
          </div></div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setView("quality")} className={TILE}><div className={TILE_HEAD}><span className="rounded bg-[var(--pm-primary-20)] px-1 py-0.2 text-[9px] font-black text-atlantic-300">HQ</span><span>QUALITY</span></div><div className="mt-2 text-base font-bold tracking-tight text-white">{quality.label}</div></button>
          <button type="button" onClick={() => setView("server")} className={TILE}><div className={TILE_HEAD}>{I.server}<span>SERVER</span></div><div className="mt-2 truncate text-base font-bold tracking-tight text-white">{server}</div></button>
          <button type="button" onClick={() => setView("subtitles")} className={TILE}><div className={TILE_HEAD}>{I.captions("size-3.5 stroke-[2.5] text-white/80")}<span>SUBTITLES</span></div><div className="mt-2 flex items-center gap-2 text-base font-bold tracking-tight text-white"><span className="truncate">{subLabel}</span></div></button>
          <button type="button" disabled={audio.tracks.length < 2} onClick={() => setView("audio")} className={audio.tracks.length < 2 ? TILE_OFF : TILE}><div className={TILE_HEAD}>{I.volume("size-3.5 stroke-[2.5] text-white/80")}<span>AUDIO</span></div><div className="mt-2 truncate text-base font-bold tracking-tight text-white">{audio.tracks.find((a) => a.id === audio.current)?.label || "Default"}</div></button>
        </div>
        <div className="flex flex-col gap-0.5 pt-1">
          <button type="button" onClick={() => setView("party")} className={ROW}><div className="flex items-center gap-3">{I.users}<span>Watch Party</span></div><div className="flex items-center gap-1.5">{inParty ? <span className="rounded-full border border-[var(--pm-primary-30)] bg-[var(--pm-primary-10)] px-2 py-0.5 text-[10px] font-bold text-atlantic-300">{partyRole === "host" ? "Hosting" : "In party"}</span> : null}{I.right()}</div></button>
          <Rule m="my-1.5" />
          <div className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-label-md font-semibold text-white/90"><div className="flex items-center gap-3">{I.captions("size-4.5 stroke-[2.5] text-white/90")}<span>Enable Subtitles</span></div><Switch on={!!subs.current} onChange={subs.toggle} label="Enable Subtitles" /></div>
          <button type="button" onClick={() => setView("playback")} className={ROW}><div className="flex items-center gap-3">{I.gauge}<span>Playback Settings</span></div>{I.right()}</button>
          <button type="button" onClick={() => setView("subset")} className={ROW}><div className="flex items-center gap-3">{I.type}<span>Subtitle Settings</span></div>{I.right()}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="transition-[transform,opacity] duration-200 translate-y-0 opacity-100 fixed bottom-20 right-4 z-[70] short:bottom-14 sm:right-6" onClick={(e) => e.stopPropagation()}>
      <div className={`pm-card max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-4.5rem)] sm:max-h-[75vh] overflow-y-auto overscroll-contain touch-pan-y [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent] rounded-2xl border p-3 text-white backdrop-blur-2xl transition-all duration-200 ${view === "subset" ? "w-84 sm:w-[370px]" : "w-80 sm:w-88"}`}>
        <div className="flex flex-col gap-1" style={{ opacity: 1, transform: "none" }}>{body}</div>
      </div>
    </div>
  );
}

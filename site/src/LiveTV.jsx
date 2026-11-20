import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLine, loadLive, nowNext, streamUrl } from "./line.js";
import Player from "./Player.jsx";
import "./live.css";

/* Live TV from your IPTV line, as the TV app lays it out (in atlantic.bz's
   materials): the categories, the channels in the chosen one, and a preview
   with what is on now and next. Your line allows one connection, so the
   preview starts when you pick a channel (not on hover) and stops before the
   full-screen player opens. */

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const Play = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;

/* a muted HLS picture for the preview */
function Preview({ src }) {
  const video = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = video.current; if (!v || !src) return undefined;
    let hls = null, gone = false;
    setFailed(false);
    import("hls.js").then(({ default: Hls }) => {
      if (gone) return;
      if (Hls.isSupported()) { hls = new Hls({ lowLatencyMode: true }); hls.loadSource(src); hls.attachMedia(v); hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setFailed(true); }); }
      else v.src = src;
      v.play().catch(() => {});
    });
    return () => { gone = true; hls?.destroy(); v.removeAttribute("src"); v.load(); };
  }, [src]);
  return (
    <div className="live-screen">
      {src ? <video ref={video} muted playsInline /> : null}
      {!src ? <div className="hint">Pick a channel to preview it here.</div> : failed ? <div className="hint">This channel did not start. Another device may be using your line, or the channel is off air.</div> : null}
      <span className="live-badge">Live</span>
    </div>
  );
}

export default function LiveTV() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState(null);
  const [guide, setGuide] = useState([]);
  const [playing, setPlaying] = useState(null);
  const line = getLine();

  useEffect(() => {
    document.title = "Live TV — Aurora";
    if (!line) return;
    loadLive().then((d) => { setData(d); setCat(d.categories[0]?.id || ""); }).catch((e) => setError(e.message || "Your line did not answer."));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const channels = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    return q ? data.channels.filter((c) => c.name.toLowerCase().includes(q)) : data.channels.filter((c) => c.categoryId === cat);
  }, [data, cat, filter]);

  // the guide for the picked channel
  useEffect(() => {
    setGuide([]);
    if (!current) return undefined;
    let live = true;
    nowNext(current).then((g) => live && setGuide(g));
    return () => { live = false; };
  }, [current]);

  const step = (d) => {
    const list = playing?.list || channels;
    const i = list.findIndex((c) => c.id === playing?.ch.id);
    const next = list[(i + d + list.length) % list.length];
    if (next) { setCurrent(next); setPlaying({ ch: next, list }); }
  };

  if (!line) {
    return (
      <div className="px-6 pb-20 pt-32 sm:px-[60px]">
        <h1 className="live-title">Live TV</h1>
        <p className="text-white/50">Connect your IPTV line in <Link className="text-atlantic-300" to="/settings">Settings → Account</Link> to watch its channels here.</p>
      </div>
    );
  }
  const [now, next] = guide;
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 pb-20 pt-32 sm:px-[60px]">
        <h1 className="live-title">Live TV<small>{line.name || "Your line"}</small></h1>
        {error ? <p className="text-white/50">{error}</p> : !data ? <p className="text-white/50">Loading channels from your line…</p> : (
          <div className="live-page">
            <div className="live-list" role="listbox" aria-label="Categories">
              {data.categories.map((c) => (
                <button key={c.id} type="button" role="option" aria-selected={c.id === cat && !filter} className={`live-cat${c.id === cat && !filter ? " on" : ""}`} onClick={() => { setCat(c.id); setFilter(""); }}>
                  <span>{c.name}</span><em>{c.count}</em>
                </button>
              ))}
            </div>
            <div className="live-list" aria-label="Channels">
              <input className="live-filter" type="search" placeholder={`Search ${data.channels.length.toLocaleString()} channels`} value={filter} onChange={(e) => setFilter(e.target.value)} />
              {channels.length ? channels.slice(0, 400).map((ch) => (
                <button key={ch.id} type="button" className={`live-ch${current?.id === ch.id ? " on" : ""}`} onClick={() => setCurrent(ch)} onDoubleClick={() => { setCurrent(ch); setPlaying({ ch, list: channels }); }}>
                  <span className="n">{ch.number}</span>
                  <span className="lg">{ch.logo ? <img src={ch.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.replaceWith(document.createTextNode(ch.name.slice(0, 2))); }} /> : ch.name.slice(0, 2)}</span>
                  <span className="tx"><div className="nm">{ch.name}</div><div className="now">{filter ? data.categories.find((c) => c.id === ch.categoryId)?.name || "" : ""}</div></span>
                </button>
              )) : <div className="live-empty">{filter ? `No channel matches “${filter}”.` : "No channels in this category."}</div>}
            </div>
            <div className="live-preview">
              <Preview src={current && !playing ? streamUrl(current) : ""} />
              <h3>{current?.name || "Live TV"}</h3>
              {now ? <p>Now: {now.title} · {clock(now.start)}–{clock(now.end)}</p> : <p>{current ? "No guide for this channel" : `${data.channels.length.toLocaleString()} channels on your line`}</p>}
              {next ? <p>Next: {next.title} · {clock(next.start)}</p> : null}
              {current ? <button type="button" className="live-watch" onClick={() => setPlaying({ ch: current, list: channels })}><Play />Watch full screen</button> : null}
            </div>
          </div>
        )}
      </div>
      {playing ? <Player key={playing.ch.id} live src={streamUrl(playing.ch)} title={playing.ch.name} subtitle={now ? `Now: ${now.title}` : ""} onClose={() => setPlaying(null)} onNext={() => step(1)} onPrev={() => step(-1)} /> : null}
    </div>
  );
}

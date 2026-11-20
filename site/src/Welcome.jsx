import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "./AuthForm.jsx";
import { AuroraMark } from "./icons.jsx";
import { tmdb, IMG } from "./tmdb.js";
import { getLine } from "./line.js";

/* The first thing a new visitor sees, as Netflix opens: a wall of what is
   showing, a line about what Aurora is, and the account form (Sign Up first).
   Next comes Connect a source (/sources). Pages a guest may open without an
   account, like a party invite, skip this (main.jsx). */

/* the poster wall: this week's popular films and series, tilted and dimmed */
function Wall() {
  const [posters, setPosters] = useState([]);
  const [cols, setCols] = useState(() => (window.innerWidth >= 1024 ? 8 : window.innerWidth >= 640 ? 6 : 4));
  useEffect(() => { const r = () => setCols(window.innerWidth >= 1024 ? 8 : window.innerWidth >= 640 ? 6 : 4); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  useEffect(() => {
    Promise.all([tmdb("/trending/movie/week"), tmdb("/trending/tv/week"), tmdb("/trending/movie/week", { page: 2 })])
      .then((rs) => setPosters(rs.flatMap((r) => r.results || []).map((x) => x.poster_path).filter(Boolean).slice(0, 48)))
      .catch(() => {});
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute grid gap-3 opacity-60" style={{ inset: "-15%", transform: "rotate(-8deg)", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {posters.map((p, i) => <div key={i} className="aspect-[2/3] overflow-hidden rounded-lg bg-abyss-800"><img src={IMG("w342", p)} alt="" loading="lazy" className="h-full w-full object-cover" /></div>)}
      </div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8), rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.9))" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.75) 70%)" }} />
    </div>
  );
}

export default function Welcome() {
  const nav = useNavigate();
  useEffect(() => { document.title = "Welcome — Aurora"; }, []);
  const done = (mode) => nav(mode === "signup" || !getLine() ? "/sources?first=1" : "/", { replace: true });
  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-black">
      <Wall />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex items-center gap-3 px-6 py-5 sm:px-12"><AuroraMark size={44} /><span className="text-2xl font-bold tracking-tight text-white">Aurora</span></header>
        <div className="flex flex-1 flex-col items-center justify-center gap-10 px-4 pb-16 lg:flex-row">
          <div className="max-w-xl text-center">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">Your films, series and live TV, in one place.</h1>
            <p className="mt-4 text-lg text-white/70">Bring your own IPTV line or playlist. Aurora finds every title on it, remembers where you stopped, and lets you watch together.</p>
            <p className="mt-6 text-sm text-white/50">Create an account to start. It takes a username and a password.</p>
          </div>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/70 p-6 shadow-2xl backdrop-blur-xl">
            <h2 className="mb-4 text-2xl font-bold text-white">Get started</h2>
            <AuthForm start="signup" onDone={done} />
          </div>
        </div>
      </div>
    </div>
  );
}

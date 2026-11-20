import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import "./atlantic.css";
import Header from "./Header.jsx";
import Home from "./Home.jsx";
import Title from "./Title.jsx";
import Browse from "./Browse.jsx";
import Settings from "./Settings.jsx";
import Search from "./Search.jsx";
import Discover from "./Discover.jsx";
import Parties from "./Parties.jsx";
import Anime from "./Anime.jsx";
import AnimeTitle from "./AnimeTitle.jsx";
import History from "./History.jsx";
import LiveTV from "./LiveTV.jsx";
import BrowseList from "./BrowseList.jsx";
import Person from "./Person.jsx";
import { ListPage, useLists } from "./lists.jsx";
import { ThemeLayer } from "./themes.jsx";
import Player from "./Player.jsx";
import Welcome from "./Welcome.jsx";
import Sources from "./Sources.jsx";
import { PartyPill, Invite } from "./PartyUI.jsx";
import { useAccount } from "./account.js";
import { getLine } from "./line.js";
import { useParty } from "./party.js";
import { syncDaily } from "./trackers.js";

/* a page for trying the player on a public test stream, in development only */
function PlayerTest() {
  const src = `/api/proxy?u=${encodeURIComponent("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8")}`;
  return <Player src={src} title="Big Buck Bunny" subtitle="Test stream · Blender Foundation (CC BY 3.0)" onClose={() => history.back()} />;
}

/* atlantic.bz's 404, for any address that is not a page */
function NotFound() {
  React.useEffect(() => { document.title = "Page not found — Aurora"; }, []);
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative flex min-h-[calc(100vh-71px)] flex-col items-center justify-center overflow-hidden px-6 text-center">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden">
          <div className="absolute left-1/4 top-[-120px] h-[420px] w-[420px] rounded-full bg-atlantic-500/30 blur-[110px]" />
          <div className="absolute right-1/4 top-[-60px] h-[380px] w-[380px] rounded-full bg-atlantic-300/20 blur-[110px]" />
          <div className="absolute left-1/2 top-[80px] h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-atlantic-700/30 blur-[110px]" />
        </div>
        <span className="bg-gradient-to-r from-atlantic-300 to-atlantic-500 bg-clip-text text-8xl font-extrabold tracking-tight text-transparent sm:text-9xl">404</span>
        <h1 className="mt-4 text-2xl font-bold text-white sm:text-3xl">This page drifted off the map.</h1>
        <p className="mt-3 max-w-md text-sm text-white/50 sm:text-base">Whatever you were looking for isn't here. Let's get you back to something worth watching.</p>
        <Link className="mt-8 flex items-center gap-2 rounded-full bg-gradient-to-r from-atlantic-300 to-atlantic-500 px-6 py-2.5 text-sm font-bold text-abyss-950 shadow-[0_8px_24px_-6px_rgba(30,203,236,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-6px_rgba(30,203,236,0.7)] active:translate-y-0" to="/">Back to Home</Link>
      </div>
    </div>
  );
}

/* /list/<id>: the list, or the 404 when there is no such list */
function List() {
  const { id } = useParams();
  return useLists().some((l) => l.id === id) ? <ListPage id={id} /> : <NotFound />;
}

/* Netflix's way in: no account → the welcome page (sign up or log in);
   signed in with no source yet → Connect a source, once. A party invite and
   the welcome page itself are open to anyone. */
function Gate({ children }) {
  const { user, loaded, accounts } = useAccount();
  const { pathname } = useLocation();
  const partying = useParty((p) => p.phase === "in" || p.phase === "reconnecting");
  // a guest in a party (an account is not needed for a private one) may go where the party plays
  const open = pathname === "/welcome" || pathname === "/welcome-preview" || pathname.startsWith("/party/") || (partying && pathname.startsWith("/title/"));
  if (!accounts) return children;
  if (!loaded) return open ? children : null;
  if (!user && !open) return <Navigate to="/welcome" replace />;
  if (user && pathname === "/welcome") return <Navigate to={getLine() ? "/" : "/sources?first=1"} replace />;
  let later = false;
  try { later = localStorage.getItem("aurora-site-source-later") === "1"; } catch { /* private mode */ }
  if (user && !getLine() && !later && pathname !== "/sources" && !open) return <Navigate to="/sources?first=1" replace />;
  return children;
}

function Shell() {
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  React.useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  React.useEffect(() => { syncDaily(); }, []);
  const bare = pathname === "/welcome" || (import.meta.env.DEV && pathname === "/welcome-preview") || (pathname === "/sources" && search.get("first") === "1");
  if (bare) {
    return (
      <>
      <ThemeLayer />
      <div className="relative z-[1]">
        <Gate>
          <Routes>
            <Route path="/welcome" element={<Welcome />} />
            {import.meta.env.DEV ? <Route path="/welcome-preview" element={<Welcome />} /> : null}
            <Route path="/sources" element={<Sources />} />
          </Routes>
        </Gate>
      </div>
      </>
    );
  }
  return (
    <>
    <ThemeLayer />
    <div className="relative z-[1]">
      <div className="relative min-h-dvh w-full overflow-x-hidden pb-20 lg:pb-16">
        <Header />
        <main className="pt-[60px]">
          <Gate>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/title/:type/:id" element={<Title />} />
            <Route path="/movies" element={<Browse type="movie" key="movie" />} />
            <Route path="/series" element={<Browse type="tv" key="tv" />} />
            <Route path="/tv" element={<Navigate to="/series" replace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/search" element={<Search />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/parties" element={<Parties />} />
            <Route path="/party/:code" element={<Invite />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/anime" element={<Anime />} />
            <Route path="/anime/:id" element={<AnimeTitle />} />
            <Route path="/anime/watch/:id/:ep" element={<AnimeTitle />} />
            <Route path="/history" element={<History />} />
            <Route path="/live" element={<LiveTV />} />
            <Route path="/browse" element={<BrowseList />} />
            <Route path="/person/:id" element={<Person />} />
            {import.meta.env.DEV ? <Route path="/player-test" element={<PlayerTest />} /> : null}
            <Route path="/list/:id" element={<List />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Gate>
        </main>
      </div>
    </div>
    <PartyPill />
    </>
  );
}

createRoot(document.getElementById("root")).render(<BrowserRouter><Shell /></BrowserRouter>);

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useParams } from "react-router-dom";
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

function Shell() {
  const { pathname } = useLocation();
  React.useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
    <ThemeLayer />
    <div className="relative z-[1]">
      <div className="relative min-h-dvh w-full overflow-x-hidden pb-20 lg:pb-16">
        <Header />
        <main className="pt-[60px]">
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
        </main>
      </div>
    </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<BrowserRouter><Shell /></BrowserRouter>);

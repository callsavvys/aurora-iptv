import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import Player from "./Player.jsx";

/* a page for trying the player on a public test stream, in development only */
function PlayerTest() {
  const src = `/api/proxy?u=${encodeURIComponent("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8")}`;
  return <Player src={src} title="Big Buck Bunny" subtitle="Test stream · Blender Foundation (CC BY 3.0)" onClose={() => history.back()} />;
}

/* pages still to be copied say so, in the site's own type */
function Soon() {
  const { pathname } = useLocation();
  return (
    <div className="px-6 pt-32 sm:px-[60px]">
      <h1 className="text-3xl font-bold text-white">Coming next</h1>
      <p className="mt-2 text-sm text-white/50">{pathname} is the next page to be copied from atlantic.bz.</p>
    </div>
  );
}

function Shell() {
  const { pathname } = useLocation();
  React.useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
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
            {import.meta.env.DEV ? <Route path="/player-test" element={<PlayerTest />} /> : null}
            <Route path="*" element={<Soon />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<BrowserRouter><Shell /></BrowserRouter>);

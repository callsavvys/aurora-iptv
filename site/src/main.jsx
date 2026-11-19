import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import "./atlantic.css";
import Header from "./Header.jsx";
import Home from "./Home.jsx";
import Title from "./Title.jsx";
import Browse from "./Browse.jsx";

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
            <Route path="/tv" element={<Browse type="tv" key="tv" />} />
            <Route path="*" element={<Soon />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<BrowserRouter><Shell /></BrowserRouter>);

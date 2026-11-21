import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAccount, displayName } from "./account.js";
import { AuroraMark, NavIcon, SearchIcon, Chevron, MenuIcon, MenuRowIcon } from "./icons.jsx";

/* atlantic.bz's header: one floating pill — the mark, the links, then search
   and the account menu. The markup and classes are the site's; Aurora's own
   changes: TV is "Series", Live TV is added, and the apps link is left out. */
const LINK = "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm leading-5 transition-colors";
const ON = "bg-white font-semibold text-abyss-950";
const OFF = "font-normal text-white/60 hover:text-white";
const ICON_BTN = "flex items-center justify-center rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-atlantic-300";

const NAV = [
  ["/discover", "Discover", "discover"],
  ["/movies", "Movies", "movies"],
  ["/series", "Series", "tv"],
  ["/anime", "Anime", "anime"],
  ["/live", "Live TV", "live"],
  ["/parties", "Watch Parties", "parties"],
];

function AccountMenu({ name = "Guest", signedIn = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  // signed in, the site says "Account" where a guest sees "Sign in"
  const rows = [signedIn ? ["/settings", "Account", "account"] : ["/settings", "Sign in", "signin"], ["/settings", "Settings", "settings"], ...(signedIn ? [["/who", "Switch account", "account"]] : []), ["/history", "Watch History", "history"], ["/live", "Live TV", "live"]];
  return (
    <div className="hidden md:block" ref={ref}>
      <div className="ndd" style={{ "--dd-size": "40px" }}>
        <div className={`ndd-grid${open ? " open" : ""}`} style={{ gridTemplateRows: open ? "40px 1fr" : "40px 0fr", right: 0 }}>
          <div className="ndd-surface" aria-hidden="true" />
          <button type="button" aria-haspopup="menu" aria-expanded={open} className="ndd-btn" onClick={() => setOpen((v) => !v)}>
            <span className="ndd-press ndd-press-start" style={{ width: "100%", height: "100%" }}>
              <span className="ndd-trigger"><span className="ndd-avatar" aria-hidden="true">{name[0].toUpperCase()}</span><span className="ndd-name">{name}</span><Chevron /></span>
            </span>
          </button>
          <div className="ndd-wrap" inert={open ? undefined : ""} style={{ gridArea: "2 / 1" }}>
            <div role="menu" tabIndex={-1} aria-orientation="vertical" className="ndd-panel">
              {rows.map(([to, label, icon]) => (
                <div style={{ display: "contents" }} key={label}>
                  <Link role="menuitem" className="ndd-row" to={to}>
                    <span className="ndd-press ndd-press-start" style={{ "--press-lead": "18px", width: "100%" }}>
                      <span className="ndd-lead">{MenuRowIcon[icon]}</span><span className="ndd-label">{label}</span>
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Header() {
  const { user } = useAccount();   // the menu shows your name once you sign in
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-[60px] items-center justify-center px-3">
      <div className="flex w-full max-w-4xl items-center gap-1 rounded-full border border-white/10 bg-pagebg/90 py-1.5 pl-4 pr-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] transition-colors duration-300">
        <Link aria-label="Home" className="mr-2 shrink-0 rounded-full" to="/"><AuroraMark /></Link>
        <nav className="hidden shrink-0 md:block">
          <ul className="flex items-center gap-1">
            {NAV.map(([to, label, icon]) => (
              <li key={to}><NavLink to={to} className={({ isActive }) => `${LINK} ${isActive ? ON : OFF}`}>{NavIcon[icon]}{label}</NavLink></li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-0.5">
          <Link aria-label="Search" className={ICON_BTN} to="/search"><SearchIcon /></Link>
          <AccountMenu name={displayName() || "Guest"} signedIn={!!user} />
          <button type="button" aria-label="Menu" className="flex items-center justify-center rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white md:hidden"><MenuIcon /></button>
        </div>
      </div>
    </header>
  );
}

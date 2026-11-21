/* The drifting particles of atlantic.bz's themes, drawn on the theme's canvas.
   The site draws them with its own script, so these are written to match what
   it shows (screenshots of each theme): falling petals (Sakura), leaves
   (Meadow), autumn leaves (Autumn), rising embers (Cinder), twinkling stars
   (Cosmos) and floating motes of light (Solstice), in the theme's colours.
   start(canvas, kind, colors) returns a function that stops it. */

const COUNT = { petals: 22, leaves: 26, maple: 24, embers: 55, stars: 90, motes: 95 };
const rand = (a, b) => a + Math.random() * (b - a);

function make(kind, w, h, colors, anywhere) {
  const y = anywhere ? rand(0, h) : kind === "embers" || kind === "motes" ? h + 10 : -10;
  const base = { x: rand(0, w), y, color: colors[Math.floor(Math.random() * colors.length)], phase: rand(0, Math.PI * 2) };
  switch (kind) {
    case "petals": return { ...base, size: rand(5, 8), vx: rand(-0.25, 0.35), vy: rand(0.35, 0.8), spin: rand(-0.02, 0.02), angle: rand(0, Math.PI), alpha: rand(0.7, 0.9) };
    case "leaves": return { ...base, size: rand(6, 10), vx: rand(-0.2, 0.3), vy: rand(0.3, 0.7), spin: rand(-0.015, 0.015), angle: rand(0, Math.PI), alpha: rand(0.5, 0.85) };
    case "maple": return { ...base, size: rand(6, 10), vx: rand(-0.3, 0.4), vy: rand(0.4, 0.9), spin: rand(-0.03, 0.03), angle: rand(0, Math.PI * 2), alpha: rand(0.6, 0.9) };
    case "embers": return { ...base, size: rand(1.3, 3), vx: rand(-0.15, 0.15), vy: -rand(0.25, 0.7), alpha: rand(0.8, 1) };
    case "stars": return { ...base, size: rand(0.7, 1.9), vx: rand(-0.03, 0.03), vy: rand(-0.03, 0.03), alpha: rand(0.45, 1), twinkle: rand(0.01, 0.03) };
    case "motes": return { ...base, size: rand(0.6, 2), vx: rand(-0.08, 0.08), vy: -rand(0.05, 0.22), alpha: rand(0.45, 1), twinkle: rand(0.01, 0.025) };
    default: return base;
  }
}

/* an autumn leaf around (0,0), about s long: a lobed blade and its stem */
function mapleLeaf(ctx, s) {
  ctx.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const lobes = 0.78 + 0.22 * Math.abs(Math.cos(a * 3.5));   // the serrated edge
    const r = s * lobes;
    const x = Math.sin(a) * r * 0.5, y = -Math.cos(a) * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-s * 0.05, s * 0.75, s * 0.1, s * 0.45);
}

export function start(canvas, kind, colors) {
  if (!canvas || !COUNT[kind]) return () => {};
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, raf = 0, items = [];
  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  items = Array.from({ length: COUNT[kind] }, () => make(kind, w, h, colors, true));
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < items.length; i += 1) {
      const p = items[i];
      if (!still) {
        p.x += p.vx + (kind === "petals" || kind === "leaves" || kind === "maple" ? Math.sin(t / 1400 + p.phase) * 0.35 : 0);
        p.y += p.vy;
        if (p.spin) p.angle += p.spin;
      }
      const out = p.y > h + 20 || p.y < -20 || p.x < -30 || p.x > w + 30;
      if (out) { items[i] = make(kind, w, h, colors, kind === "stars"); continue; }
      let a = p.alpha;
      if (p.twinkle) a *= 0.8 + 0.2 * Math.sin(t * p.twinkle * 0.06 + p.phase);
      if (kind === "embers") a *= 0.88 + 0.12 * Math.sin(t / 220 + p.phase);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (kind === "petals" || kind === "leaves") { ctx.rotate(p.angle); ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * (kind === "petals" ? 0.62 : 0.55), 0, 0, Math.PI * 2); ctx.fill(); }
      else if (kind === "maple") { ctx.rotate(p.angle); mapleLeaf(ctx, p.size); }
      else {
        if (kind === "embers") { ctx.shadowColor = p.color; ctx.shadowBlur = 6; }
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", size);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
}

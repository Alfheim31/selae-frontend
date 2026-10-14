import { useEffect, useState } from "react";
import QRCode from "qrcode";

/* Styles, formatting helpers and small pieces shared by the public
   pages and the organizer console. */

export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');
.selae{
  --bg:#0C1730; --rail:#091226; --surface:#122144; --raised:#1A2C55; --line:#263A69;
  --text:#EAF0FB; --muted:#A3B1D0; --faint:#7384AB;
  --gold:#E4B23E; --gold-ink:#241A03; --data:#7FA2FF;
  --ok:#2FBF76; --ok-ink:#052113; --bad:#C63A3C; --dup:#3D6BDB; --warn:#F39A3D; --warn-ink:#2A1603;
  font-family:'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background:var(--bg); color:var(--text); min-height:100vh; font-variant-numeric:tabular-nums;
  line-height:1.45;
}
.selae *{box-sizing:border-box}
.selae button{cursor:pointer; font:inherit}
.selae button:disabled{opacity:.45; cursor:not-allowed}
.selae :focus-visible{outline:2px solid var(--gold); outline-offset:2px}
.selae .muted{color:var(--muted)} .selae .faint{color:var(--faint)}

.rail{background:var(--rail); border-right:1px solid var(--line)}
.mark{width:34px;height:34px;border-radius:9px;position:relative;background:var(--surface);border:1px solid var(--line)}
.mark:before,.mark:after{content:"";position:absolute;width:11px;height:11px;border:3px solid var(--gold)}
.mark:before{top:6px;left:6px;border-right:0;border-bottom:0;border-radius:3px 0 0 0}
.mark:after{bottom:6px;right:6px;border-left:0;border-top:0;border-radius:0 0 3px 0}
.navbtn{display:flex;gap:.7rem;align-items:center;padding:.65rem .8rem;border-radius:10px;color:var(--muted);
  font-weight:700;width:100%;text-align:left;background:transparent;border:0}
.navbtn:hover{background:var(--surface);color:var(--text)}
.navbtn[aria-current="page"]{background:var(--surface);color:var(--text);box-shadow:inset 3px 0 0 var(--gold)}
.mnav{gap:.25rem;overflow-x:auto}
.mnav .navbtn{width:auto;white-space:nowrap}

.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;font-weight:700;border-radius:10px;
  padding:.6rem 1rem;border:1px solid var(--line);background:var(--raised);color:var(--text)}
.btn:hover:not(:disabled){border-color:var(--muted)}
.btn-gold{background:var(--gold);border-color:var(--gold);color:var(--gold-ink)}
.btn-gold:hover:not(:disabled){filter:brightness(1.07);border-color:var(--gold)}
.btn-ghost{background:transparent}
.btn-sm{padding:.4rem .7rem;font-size:.85rem}
.field{position:relative}
.field svg{position:absolute;left:.8rem;top:50%;transform:translateY(-50%);color:var(--faint)}
.input{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem .7rem 2.5rem;
  color:var(--text);width:100%;font-size:1rem}
.input::placeholder{color:var(--faint)}
.input:focus{border-color:var(--gold);outline:none}

.chip{display:inline-flex;align-items:center;gap:.35rem;font-size:.78rem;font-weight:700;padding:.12rem .55rem;
  border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.chip.barcode{color:#B9CBFF;border-color:#3A5596}
.chip.qr{color:#B9CBFF;border-color:#3A5596}
.chip.ocr{color:var(--gold);border-color:#7A6225}
.chip.confirmed{color:var(--warn);border-color:#7F5424}
.chip.manual{color:var(--muted)}
.chip.in{color:var(--ok);border-color:#1F6B47}

.seg{display:inline-flex;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:3px}
.seg button{border:0;background:transparent;color:var(--muted);font-weight:700;padding:.35rem .75rem;border-radius:7px;font-size:.88rem}
.seg button[aria-pressed="true"]{background:var(--raised);color:var(--text)}

.tbl{width:100%;border-collapse:separate;border-spacing:0}
.tbl th{white-space:nowrap;font-weight:700;color:var(--faint);font-size:.8rem;text-align:left;padding:.6rem .9rem;
  border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);z-index:1}
.tbl td{white-space:nowrap;padding:.62rem .9rem;border-bottom:1px solid rgba(38,58,105,.55);font-size:.92rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:0}

.capbar{height:16px;border-radius:999px;background:var(--bg);border:1px solid var(--line);position:relative;overflow:hidden}
.capfill{height:100%;border-radius:999px;transition:width .5s ease}
.captick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--muted)}

.feed li{display:grid;grid-template-columns:22px 1fr auto;gap:.65rem;padding:.7rem 0;border-bottom:1px solid rgba(38,58,105,.55)}
.feed li:last-child{border-bottom:0}

/* Gate scanner */
.viewfinder{position:relative;border-radius:18px;overflow:hidden;aspect-ratio:4/3;border:1px solid var(--line);
  background:radial-gradient(ellipse at 50% 38%, #22314f 0%, #121b30 55%, #0a1020 100%)}
.frame{position:absolute;left:18%;right:18%;top:16%;bottom:16%}
.corner{position:absolute;width:42px;height:42px;border:0 solid var(--gold)}
.corner.tl{top:0;left:0;border-top-width:4px;border-left-width:4px;border-top-left-radius:12px}
.corner.tr{top:0;right:0;border-top-width:4px;border-right-width:4px;border-top-right-radius:12px}
.corner.bl{bottom:0;left:0;border-bottom-width:4px;border-left-width:4px;border-bottom-left-radius:12px}
.corner.br{bottom:0;right:0;border-bottom-width:4px;border-right-width:4px;border-bottom-right-radius:12px}
.vf-status{position:absolute;left:14px;top:14px;display:flex;align-items:center;gap:.45rem;font-size:.82rem;font-weight:700;
  background:rgba(9,18,38,.75);padding:.3rem .65rem;border-radius:999px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.idcard{position:absolute;left:50%;top:50%;width:min(58%,320px);aspect-ratio:1.586;background:#F3F5FA;border-radius:12px;
  box-shadow:0 22px 44px rgba(0,0,0,.5);overflow:hidden;color:#1B2440;
  transform:translate(-50%,-50%) rotate(-3deg);transition:transform .35s ease, opacity .3s ease}
.idcard.away{opacity:0;transform:translate(-50%,-34%) rotate(-3deg) scale(.92)}
.idcard .band{height:21%;background:#7B1E2A;color:#fff;font-weight:700;font-size:.62rem;display:flex;align-items:center;padding:0 7%}
.idcard .photo{position:absolute;left:7%;top:30%;width:23%;height:43%;background:#C5CEE2;border-radius:4px}
.idcard .info{position:absolute;left:36%;top:30%;right:7%}
.idcard .ln{height:7px;background:#D3DAE8;border-radius:3px;margin-bottom:6px}
.idcard .num{display:inline-block;font-weight:700;font-size:.9rem;padding:1px 5px;margin:2px 0 0 -5px;border-radius:4px}
.idcard .num.reading{outline:2px solid #B8860B;outline-offset:1px;background:rgba(228,178,62,.28)}
.idcard .bars{position:absolute;left:7%;right:7%;bottom:8%;height:13%;
  background:repeating-linear-gradient(90deg,#1B2440 0 2px,transparent 2px 4px,#1B2440 4px 5px,transparent 5px 8px,#1B2440 8px 11px,transparent 11px 13px)}
.glare{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle at 72% 74%, rgba(255,255,255,.97) 0%, rgba(255,255,255,.82) 16%, rgba(255,255,255,0) 42%)}
.viewfinder video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#0a1020}
.viewfinder video.frozen{filter:grayscale(.15) brightness(.8)}
.vf-ocr{position:absolute;right:3%;top:3.5%;z-index:3}
.vf-note{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);background:rgba(9,18,38,.82);color:var(--text);
  font-weight:700;font-size:.82rem;padding:.3rem .7rem;border-radius:999px;white-space:nowrap}
.vf-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;
  padding:1.5rem;text-align:center}
.vf-center p{max-width:42ch;color:var(--muted);line-height:1.55}
.vf-center ol{text-align:left;color:var(--muted);font-size:.92rem;line-height:1.6;max-width:42ch}
.camselect{background:var(--bg);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:.35rem .55rem;
  font:inherit;font-size:.85rem;max-width:220px}
.spin{width:26px;height:26px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.sweep{position:absolute;left:0;right:0;height:3px;background:var(--gold);box-shadow:0 0 14px var(--gold);animation:sweep 1s ease-in-out infinite alternate}
@keyframes sweep{from{top:4%}to{top:96%}}
.ocr-tag{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);background:var(--gold);color:var(--gold-ink);
  font-weight:700;font-size:.82rem;padding:.3rem .7rem;border-radius:999px;white-space:nowrap}

.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem}
.step{border-top:3px solid var(--line);padding-top:.45rem;font-size:.8rem;color:var(--faint);font-weight:700}
.step.active{border-color:var(--gold);color:var(--text)}
.step.done{border-color:#4E6BAF;color:var(--muted)}
.step.skipped{border-style:dashed;opacity:.6}

.result{border-radius:18px;padding:1.5rem;height:100%;min-height:260px;display:flex;flex-direction:column;gap:.9rem;
  transition:background-color .18s ease}
.result.idle{background:var(--surface);border:1px solid var(--line)}
.result.ok{background:var(--ok);color:var(--ok-ink)}
.result.bad{background:var(--bad);color:#fff}
.result.dup{background:var(--dup);color:#fff}
.result.warn{background:var(--warn);color:var(--warn-ink)}
@media (min-width:1024px){.result{min-height:420px}}
.result .who{text-wrap:balance;font-size:clamp(1.7rem,3.2vw,2.6rem);font-weight:700;line-height:1.1;letter-spacing:-.01em}
.result .state{display:flex;align-items:center;gap:.6rem;font-size:1.2rem;font-weight:700}
.result .meta{display:grid;grid-template-columns:auto 1fr;gap:.25rem 1rem;font-size:1rem}
.result .meta dt{opacity:.75}
.result .btn-on{background:rgba(255,255,255,.92);color:#10182C;border-color:transparent}
.result .btn-on:hover:not(:disabled){background:#fff}
.countdown{height:6px;border-radius:999px;background:rgba(0,0,0,.18);overflow:hidden;margin-top:auto}
.countdown > div{height:100%;background:currentColor;opacity:.5;animation-name:drain;animation-timing-function:linear;animation-fill-mode:forwards}
@keyframes drain{from{width:100%}to{width:0}}
.cand{display:flex;justify-content:space-between;align-items:center;gap:1rem;width:100%;text-align:left;
  background:rgba(255,255,255,.4);border:2px solid transparent;border-radius:12px;padding:.75rem 1rem;color:inherit}
.cand:hover{border-color:currentColor;background:rgba(255,255,255,.55)}
.suggest{position:absolute;left:0;right:0;bottom:calc(100% + 6px);background:var(--raised);border:1px solid var(--line);
  border-radius:12px;overflow:hidden;z-index:5;box-shadow:0 18px 36px rgba(0,0,0,.4)}
.suggest button{display:flex;justify-content:space-between;gap:1rem;width:100%;text-align:left;background:transparent;border:0;
  color:var(--text);padding:.6rem .9rem;border-bottom:1px solid var(--line)}
.suggest button:last-child{border-bottom:0}
.suggest button:hover,.suggest button[data-active="true"]{background:var(--surface)}
.hold{position:relative;overflow:hidden}
.hold .fill{position:absolute;left:0;top:0;bottom:0;background:rgba(228,178,62,.35)}
.demo summary{cursor:pointer;font-weight:700;color:var(--muted);list-style:none}
.demo summary::-webkit-details-marker{display:none}
.toast{position:fixed;right:20px;bottom:20px;background:var(--raised);border:1px solid var(--line);padding:.7rem 1rem;
  border-radius:12px;font-weight:700;z-index:50}

/* ---- public pages (Luma-style) ---- */
.topbar{position:sticky;top:0;z-index:20;background:rgba(12,23,48,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.toplink{color:var(--muted);font-weight:700;padding:.45rem .7rem;border-radius:9px;background:transparent;border:0;display:inline-flex;align-items:center;gap:.4rem}
.toplink:hover,.toplink[aria-current="page"]{color:var(--text);background:var(--surface)}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.narrow{max-width:760px;margin:0 auto;padding:0 16px}
.cover{position:relative;border-radius:18px;overflow:hidden;background:var(--c-bg);aspect-ratio:1/1;display:flex;align-items:flex-end;padding:1.2rem;color:#fff}
.cover:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 80% 15%,rgba(255,255,255,.35),transparent 45%),radial-gradient(circle at 10% 95%,rgba(0,0,0,.35),transparent 55%)}
.cover .cmark{position:absolute;top:16%;left:16%;right:16%;bottom:30%}
.cover .cmark span{position:absolute;width:26%;height:26%;border:0 solid rgba(255,255,255,.85)}
.cover .cmark .a{top:0;left:0;border-top-width:6px;border-left-width:6px;border-top-left-radius:14px}
.cover .cmark .b{bottom:0;right:0;border-bottom-width:6px;border-right-width:6px;border-bottom-right-radius:14px}
.cover .ctitle{position:relative;font-weight:700;font-size:1.05rem;line-height:1.2;text-shadow:0 1px 8px rgba(0,0,0,.35);text-wrap:balance}
.cover.thumb{aspect-ratio:1/1;width:84px;padding:0;border-radius:12px;flex-shrink:0}
.cover.thumb .cmark span{border-width:0}.cover.thumb .cmark .a{border-top-width:4px;border-left-width:4px}.cover.thumb .cmark .b{border-bottom-width:4px;border-right-width:4px}
.evcard{display:flex;gap:1rem;align-items:center;padding:1rem;border-radius:16px;background:var(--surface);border:1px solid var(--line);
  width:100%;text-align:left;color:inherit;transition:border-color .15s ease}
.evcard:hover{border-color:var(--muted)}
.datebox{width:54px;flex-shrink:0;text-align:center;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg)}
.datebox .mo{font-size:.68rem;font-weight:700;letter-spacing:.06em;background:var(--raised);color:var(--muted);padding:.12rem 0}
.datebox .dy{font-size:1.3rem;font-weight:700;padding:.15rem 0 .2rem}
.factrow{display:flex;gap:.8rem;align-items:flex-start}
.facticon{width:40px;height:40px;border-radius:10px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted);flex-shrink:0;background:var(--surface)}
.lbl{display:block;font-size:.85rem;font-weight:700;color:var(--muted);margin-bottom:.3rem}
.inp{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:.65rem .8rem;color:var(--text);width:100%;font-size:1rem;font:inherit}
.inp:focus{border-color:var(--gold);outline:none}
.inp::placeholder{color:var(--faint)}
select.inp{appearance:auto}
textarea.inp{resize:vertical;min-height:110px}
.swatch{width:34px;height:34px;border-radius:50%;border:3px solid transparent;cursor:pointer}
.swatch[aria-pressed="true"]{border-color:var(--text);box-shadow:0 0 0 2px var(--bg) inset}
.pill{display:inline-flex;align-items:center;gap:.4rem;font-weight:700;font-size:.85rem;padding:.25rem .7rem;border-radius:999px}
.pill.going{background:rgba(47,191,118,.15);color:var(--ok)}
.pill.waitlist{background:rgba(243,154,61,.15);color:var(--warn)}
.pill.cancelled{background:rgba(198,58,60,.18);color:#FF7B7D}
.pill.host{background:rgba(228,178,62,.15);color:var(--gold)}
.pill.past{background:var(--raised);color:var(--muted)}
.qrbox{background:#fff;border-radius:16px;padding:10px;display:inline-block;line-height:0}
.qrbox svg{width:100%;height:auto;display:block}
.ticket{background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden}
.ticket .stub{border-top:2px dashed var(--line);position:relative}
.alert{border-radius:12px;padding:.75rem 1rem;font-weight:700}
.alert.err{background:rgba(198,58,60,.18);color:#FFB3B4;border:1px solid rgba(198,58,60,.5)}
.alert.ok{background:rgba(47,191,118,.12);color:#9BE8C0;border:1px solid rgba(47,191,118,.4)}
.modal-bg{position:fixed;inset:0;background:rgba(5,10,22,.7);z-index:40;display:flex;align-items:center;justify-content:center;padding:16px}
.modal{background:var(--surface);border:1px solid var(--line);border-radius:18px;max-width:440px;width:100%;padding:1.25rem;max-height:calc(100vh - 32px);overflow:auto}
.copyrow{display:flex;gap:.5rem}
.copyrow input{flex:1;min-width:0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;background:var(--bg);padding:.05rem .35rem;border-radius:5px}
.testgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem}
.testcard{background:#fff;color:#10182C;border-radius:14px;padding:1rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.3rem}
.testcard .qrbox{padding:0;width:170px}
@media print{
  .selae{background:#fff;color:#000} .rail,.selae header,.topbar,.noprint{display:none !important}
  .testcard{border:1px solid #999;break-inside:avoid}
}
@media (prefers-reduced-motion: reduce){ .selae *{animation:none !important; transition:none !important} }
`;

/* ---------------- formatting ---------------- */
export const fmtTime = (d) => {
  d = new Date(d);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};
export const fmtDate = (d, opts = { weekday: "long", month: "long", day: "numeric" }) => new Date(d).toLocaleDateString("en-US", opts);
export const fmtDateShort = (d) => fmtDate(d, { weekday: "short", month: "short", day: "numeric" });
export function fmtRange(start, end) {
  const s = new Date(start), e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${fmtDate(s)}, ${fmtTime(s)} to ${fmtTime(e)}`
    : `${fmtDateShort(s)}, ${fmtTime(s)} to ${fmtDateShort(e)}, ${fmtTime(e)}`;
}
export const formatName = (s) =>
  s.first || s.last
    ? `${s.last}${s.suffix ? " " + s.suffix : ""}, ${s.first}${s.middle ? " " + s.middle + "." : ""}`
    : s.id;
export const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const pct = (n) => `${Math.round((Number.isFinite(n) ? n : 0) * 100)}%`;

// Same rules the server applies, so the preview matches what gets saved
export function tidyName(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
export const tidyInitial = (raw) => { const m = String(raw || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Simulated OCR output for the demo scenarios (the ID on screen is a drawing, so
// there is nothing real to read). Swaps digits OCR commonly confuses under glare.
// The read is then matched by the real matcher on the server.
const CONFUSE = { 0: "8", 1: "7", 2: "7", 3: "8", 4: "9", 5: "6", 6: "5", 7: "1", 8: "3", 9: "4" };
const rand = (a, b) => a + Math.random() * (b - a);
export function simulateRead(id, kind, twin) {
  const digits = id.replace(/\D/g, "").split("");
  const conf = digits.map(() => rand(0.88, 0.99));
  if (kind === "hard" && twin) {
    // Smudge exactly where this guest's number differs from a look-alike guest's,
    // so the read sits between the two (alternately looking like each one)
    const other = twin.replace(/\D/g, "");
    const diffs = digits.map((d, i) => (d !== other[i] ? i : -1)).filter((i) => i >= 0);
    diffs.forEach((i, k) => { if (k % 2 === 1) digits[i] = other[i]; conf[i] = rand(0.25, 0.4); });
  } else {
    // One glare-damaged digit, years excluded
    const i = 4 + Math.floor(Math.random() * 5);
    digits[i] = CONFUSE[digits[i]];
    conf[i] = rand(0.45, 0.7);
  }
  return { read: digits.join(""), conf };
}

export const METHOD_LABEL = { qr: "QR ticket", barcode: "ID barcode", ocr: "OCR", confirmed: "Operator confirmed", manual: "Manual entry" };
export const METHOD_SHORT = { qr: "QR", barcode: "ID barcode", ocr: "OCR", confirmed: "Confirmed", manual: "Manual" };
export const OUTCOME_LABEL = {
  approved: "Checked in", notreg: "Not registered", dup: "Already checked in", full: "Venue at capacity",
  unresolved: "Couldn't identify", waitlist: "On the waitlist", wrongevent: "Ticket for another event",
};

/* ---------------- event covers ---------------- */
export const COLORS = {
  gold: ["#E4B23E", "#9A5B0F"], blue: ["#7FA2FF", "#2B3F8F"], green: ["#2FBF76", "#0E5A39"],
  rose: ["#FF7B9C", "#7A1F3D"], violet: ["#B18CFF", "#4B2A8F"], teal: ["#3CC8C8", "#0F5C66"],
};
export function Cover({ event, thumb = false, className = "" }) {
  const [a, b] = COLORS[event.color] || COLORS.gold;
  return (
    <div className={`cover ${thumb ? "thumb" : ""} ${className}`} style={{ "--c-bg": `linear-gradient(140deg, ${a}, ${b})` }} aria-hidden="true">
      <div className="cmark"><span className="a" /><span className="b" /></div>
      {!thumb && <div className="ctitle">{event.title}</div>}
    </div>
  );
}

export function Mark() {
  return <div className="mark" aria-hidden="true" />;
}

/* ---------------- QR code ---------------- */
export function QrCode({ value, size = 220, label }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(""); });
    return () => { alive = false; };
  }, [value]);
  return (
    <div className="qrbox" style={{ width: size }} role="img" aria-label={label || "QR code"}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/* ---------------- hooks ---------------- */
export function useHashRoute() {
  const read = () => (typeof window === "undefined" ? "" : window.location.hash.replace(/^#\/?/, ""));
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
export const go = (path) => { window.location.hash = `#/${path.replace(/^\//, "")}`; };

export function useToast() {
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast];
}

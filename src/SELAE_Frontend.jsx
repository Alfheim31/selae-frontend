import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import {
  LayoutDashboard, ScanLine, BarChart3, Search, CheckCircle2, XCircle, AlertTriangle, Camera, CameraOff,
  Volume2, VolumeX, Lock, Download, History, HelpCircle, Ban, Keyboard,
} from "lucide-react";

/* ------------------------------------------------------------------
   SELAE — Smart Event Logistics and Analytics Engine
   Clickable prototype of the operator UI (dashboard, gate scanner,
   post-event analytics). All data is simulated in memory.
------------------------------------------------------------------- */

const CSS = `
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

@media (prefers-reduced-motion: reduce){ .selae *{animation:none !important; transition:none !important} }
`;

/* ---------------- utilities ---------------- */
const BASE = new Date(2026, 8, 18, 12, 30); // check-in opened 12:30 PM
const OPEN_MINUTES = 42;
const MOUNT = Date.now();
const simNow = () => new Date(BASE.getTime() + OPEN_MINUTES * 60000 + (Date.now() - MOUNT));
const CAPACITY = 200;
const EVENT = { title: "CS Department General Assembly", venue: "University Gymnasium", date: "Friday, September 18, 2026" };

const fmtTime = (d) => {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};
const formatName = (s) => `${s.last}${s.suffix ? " " + s.suffix : ""}, ${s.first}${s.middle ? " " + s.middle + "." : ""}`;
const norm = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pct = (n) => `${Math.round(n * 100)}%`;

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Digits OCR commonly confuses under glare
const CONFUSE = { 0: "8", 1: "7", 2: "7", 3: "8", 4: "9", 5: "6", 6: "5", 7: "1", 8: "3", 9: "4" };
function misread(id) {
  const [yr, num] = id.split("-");
  const i = Math.floor(Math.random() * num.length);
  return `${yr}-${num.slice(0, i)}${CONFUSE[num[i]]}${num.slice(i + 1)}`;
}

const METHOD_LABEL = { barcode: "Barcode", ocr: "OCR", confirmed: "Operator confirmed", manual: "Manual entry" };
const METHOD_SHORT = { barcode: "Barcode", ocr: "OCR", confirmed: "Confirmed", manual: "Manual" };
const OUTCOME_LABEL = {
  approved: "Checked in", notreg: "Not registered", dup: "Already checked in", full: "Venue at capacity", unresolved: "Couldn't identify",
};

/* ---------------- seeded sample data ---------------- */
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SURNAMES = ["Santos", "Reyes", "Garcia", "Mendoza", "Bautista", "Villanueva", "Ramos", "Aquino", "Castillo", "Del Rosario",
  "De Leon", "Navarro", "Salazar", "Tolentino", "Manalo", "Pascual", "Soriano", "Lim", "Gonzales", "Fernandez", "Cruz", "Rivera",
  "Ocampo", "Mercado", "Aguilar", "Valdez", "Domingo", "Francisco", "Serrano", "Lopez", "Dizon", "Panganiban", "Sy", "Magbanua"];
const GIVEN = ["Juan", "Andrea", "Jose", "Kevin", "Patricia", "Mark Anthony", "Kristine", "John Paul", "Angelica", "Carlo", "Bea",
  "Miguel", "Sofia", "Rafael", "Jasmine", "Paolo", "Nicole", "Gabriel", "Ella", "Joshua", "Camille", "Adrian", "Janelle", "Renz",
  "Trisha", "Vince", "Alyssa", "Nathan", "Denise", "Lance"];
const MIDDLES = "ABCDEFGLMNPRSTV";
const SECTIONS = ["BSCS 1-1", "BSCS 1-2", "BSCS 2-1", "BSCS 2-2", "BSCS 3-1", "BSCS 3-2", "BSCS 3-3", "BSCS 3-4", "BSCS 4-1", "BSCS 4-2"];

function buildData() {
  const r = rng(315);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const used = new Set();
  const students = [];
  while (students.length < 230) {
    const section = pick(SECTIONS);
    const year = Number(section.split(" ")[1][0]);
    const id = `${2027 - year}-${10000 + Math.floor(r() * 89999)}`;
    if (used.has(id)) continue;
    used.add(id);
    const sr = r();
    students.push({ id, section, year, last: pick(SURNAMES), first: pick(GIVEN), middle: r() < 0.1 ? "" : pick(MIDDLES),
      suffix: sr < 0.03 ? "Jr." : sr < 0.04 ? "III" : "" });
  }
  // Names that exercise the formatting rules
  const showcase = [
    { last: "Dela Cruz", first: "Juan", middle: "M", suffix: "" },
    { last: "Santos", first: "Maria Clara", middle: "R", suffix: "" },
    { last: "Peña", first: "Andrea", middle: "L", suffix: "" },
    { last: "Reyes", first: "Jose", middle: "P", suffix: "Jr." },
    { last: "Tan", first: "Kevin", middle: "", suffix: "" },
    { last: "Delos Santos", first: "John Paul", middle: "V", suffix: "" },
    { last: "Muñoz", first: "Camille", middle: "S", suffix: "" },
  ];
  showcase.forEach((n, i) => Object.assign(students[i], n));

  const byId = new Map(students.map((s) => [s.id, s]));
  const registered = new Set(students.slice(0, 180).map((s) => s.id));

  // Shuffle registered, check in 128 with a peak around 12:52 PM
  const reg = students.slice(0, 180);
  for (let i = reg.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [reg[i], reg[j]] = [reg[j], reg[i]]; }
  const checkins = new Map();
  const log = [];
  const at = (min) => new Date(BASE.getTime() + min * 60000 + Math.floor(r() * 59) * 1000);
  reg.slice(0, 128).forEach((s) => {
    const min = Math.min(41, Math.max(0, 22 + (r() + r() + r() - 1.5) * 17));
    const roll = r();
    const method = roll < 0.78 ? "barcode" : roll < 0.91 ? "ocr" : roll < 0.96 ? "confirmed" : "manual";
    const confidence = method === "barcode" ? 1 : method === "ocr" ? 0.9 + r() * 0.09 : method === "confirmed" ? 0.62 + r() * 0.16 : null;
    const time = at(min);
    checkins.set(s.id, { time, method, confidence });
    log.push({ uid: `s${log.length}`, time, sid: s.id, outcome: "approved", method, confidence });
  });
  students.slice(180).slice(0, 6).forEach((s) => log.push({ uid: `s${log.length}`, time: at(5 + r() * 36), sid: s.id, outcome: "notreg", method: "barcode" }));
  [...checkins.keys()].slice(0, 3).forEach((sid) => {
    const c = checkins.get(sid);
    log.push({ uid: `s${log.length}`, time: new Date(Math.min(c.time.getTime() + 6 * 60000, BASE.getTime() + 41.5 * 60000)), sid, outcome: "dup", method: "barcode" });
  });
  log.push({ uid: `s${log.length}`, time: at(31), sid: null, outcome: "unresolved", method: "ocr" });
  log.sort((a, b) => b.time - a.time);

  return { students, byId, registered, checkins, log };
}

/* ---------------- app ---------------- */
export default function App() {
  const seed = useMemo(() => buildData(), []);
  const [checkins, setCheckins] = useState(seed.checkins);
  const [log, setLog] = useState(seed.log);
  const [view, setView] = useState("dashboard");
  const [gateMode, setGateMode] = useState(false);
  const [now, setNow] = useState(simNow());
  const [toast, setToast] = useState("");
  const checkinsRef = useRef(checkins);
  checkinsRef.current = checkins;

  useEffect(() => {
    const t = setInterval(() => setNow(simNow()), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const actions = useMemo(() => {
    const addLog = (e) => setLog((l) => [{ uid: Math.random().toString(36).slice(2), time: simNow(), ...e }, ...l]);
    const rnd = (a) => a[Math.floor(Math.random() * a.length)];
    return {
      student: (sid) => seed.byId.get(sid),
      isRegistered: (sid) => seed.registered.has(sid),
      // Business rules from the Logical Layer: registration, duplicates, capacity
      evaluate(sid, { forceFull = false } = {}) {
        const cr = checkinsRef.current;
        if (!seed.byId.has(sid)) return { outcome: "unresolved" };
        if (!seed.registered.has(sid)) return { outcome: "notreg" };
        if (cr.has(sid)) return { outcome: "dup", previous: cr.get(sid) };
        if (forceFull || cr.size >= CAPACITY) return { outcome: "full" };
        return { outcome: "approved" };
      },
      commit(sid, method, confidence) {
        const time = simNow();
        setCheckins((m) => new Map(m).set(sid, { time, method, confidence }));
        addLog({ sid, outcome: "approved", method, confidence });
        return time;
      },
      logScan: addLog,
      pickFor(kind) {
        const cr = checkinsRef.current;
        if (kind === "notreg") return rnd(seed.students.filter((s) => !seed.registered.has(s.id)));
        if (kind === "dup") return seed.byId.get(rnd([...cr.keys()]));
        const pool = seed.students.filter((s) => seed.registered.has(s.id) && !cr.has(s.id));
        return rnd(pool.length ? pool : seed.students.filter((s) => seed.registered.has(s.id)));
      },
      // Fuzzy match of an OCR read against this event's registered list
      candidates(read) {
        return [...seed.registered]
          .map((id) => ({ id, d: lev(read, id) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map(({ id, d }, i) => ({ student: seed.byId.get(id), confidence: Math.max(0.31, 0.79 - d * 0.13 - i * 0.03 - Math.random() * 0.05) }));
      },
      search(q) {
        const n = norm(q);
        if (n.length < 2) return [];
        return seed.students
          .filter((s) => norm(s.id).includes(n) || norm(s.last + s.first).includes(n) || norm(s.first + s.last).includes(n))
          .sort((a, b) => Number(seed.registered.has(b.id)) - Number(seed.registered.has(a.id)))
          .slice(0, 6);
      },
    };
  }, [seed]);

  const data = { ...seed, checkins, log, now };
  const nav = [
    { id: "dashboard", label: "Live dashboard", icon: LayoutDashboard },
    { id: "scanner", label: "Gate scanner", icon: ScanLine },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="selae">
      <style>{CSS}</style>
      <div className="flex min-h-screen">
        {!gateMode && (
          <aside className="rail hidden md:flex flex-col w-60 shrink-0 p-4 gap-6">
            <div className="flex items-center gap-3 px-1 pt-1">
              <div className="mark" aria-hidden="true" />
              <div>
                <div className="text-lg font-bold" style={{ letterSpacing: "0.02em" }}>SELAE</div>
                <div className="text-xs faint">Event check-in</div>
              </div>
            </div>
            <nav className="flex flex-col gap-1" aria-label="Main">
              {nav.map((n) => (
                <button key={n.id} className="navbtn" aria-current={view === n.id ? "page" : undefined} onClick={() => setView(n.id)}>
                  <n.icon size={18} /> {n.label}
                </button>
              ))}
            </nav>
            <div className="mt-auto text-sm px-1">
              <div className="faint">Current event</div>
              <div className="font-bold">{EVENT.title}</div>
              <div className="muted">{EVENT.venue}</div>
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0">
          {!gateMode && (
            <header className="px-4 md:px-6 pt-5 pb-3 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold">{EVENT.title}</h1>
                  <p className="muted text-sm">{EVENT.venue}, {EVENT.date}</p>
                </div>
                <div className="flex items-center gap-2 text-sm font-bold">
                  <span className="dot" style={{ background: "var(--ok)" }} />
                  <span>Check-in open since {fmtTime(BASE)}<span className="faint font-normal">, now {fmtTime(now)}</span></span>
                </div>
              </div>
              <nav className="mnav flex md:hidden" aria-label="Main">
                {nav.map((n) => (
                  <button key={n.id} className="navbtn" aria-current={view === n.id ? "page" : undefined} onClick={() => setView(n.id)}>
                    <n.icon size={16} /> {n.label}
                  </button>
                ))}
              </nav>
            </header>
          )}
          <div className={gateMode ? "p-3 md:p-5" : "p-4 md:p-6"}>
            {view === "dashboard" && <Dashboard data={data} onOpenScanner={() => setView("scanner")} />}
            {view === "scanner" && <Scanner data={data} actions={actions} gateMode={gateMode} setGateMode={setGateMode} />}
            {view === "analytics" && <Analytics data={data} onToast={setToast} />}
          </div>
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ---------------- dashboard ---------------- */
function arrivalBuckets(checkins, now, size = 5) {
  const n = Math.max(1, Math.ceil((now - BASE) / (size * 60000)));
  const arr = Array.from({ length: n }, (_, i) => ({ label: fmtTime(new Date(BASE.getTime() + i * size * 60000)), count: 0 }));
  for (const c of checkins.values()) {
    const i = Math.floor((c.time - BASE) / (size * 60000));
    if (i >= 0 && i < n) arr[i].count++;
  }
  return arr;
}

const chartTip = { background: "#1A2C55", border: "1px solid #263A69", borderRadius: 10, color: "#EAF0FB" };

function MethodChip({ method, confidence }) {
  if (!method) return null;
  const conf = method === "ocr" || method === "confirmed" ? ` ${pct(confidence)}` : "";
  return <span className={`chip ${method}`} title={METHOD_LABEL[method]}>{METHOD_SHORT[method]}{conf}</span>;
}

function OutcomeIcon({ outcome }) {
  const map = {
    approved: [CheckCircle2, "var(--ok)"], notreg: [XCircle, "#FF7B7D"], dup: [History, "#8FB0FF"],
    full: [Ban, "#FF7B7D"], unresolved: [HelpCircle, "var(--warn)"],
  };
  const [Icon, color] = map[outcome] || map.unresolved;
  return <Icon size={20} color={color} aria-label={OUTCOME_LABEL[outcome]} />;
}

function Dashboard({ data, onOpenScanner }) {
  const { students, registered, checkins, log, now, byId } = data;
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const count = checkins.size;
  const fill = count / CAPACITY;
  const fillColor = fill >= 1 ? "var(--bad)" : fill >= 0.9 ? "var(--warn)" : "var(--ok)";
  const last10 = [...checkins.values()].filter((c) => now - c.time <= 10 * 60000).length;
  const attention = log.filter((l) => l.outcome !== "approved");
  const buckets = useMemo(() => arrivalBuckets(checkins, now), [checkins, now]);

  const rows = useMemo(() => {
    const n = norm(q);
    return students
      .filter((s) => registered.has(s.id))
      .filter((s) => (filter === "in" ? checkins.has(s.id) : filter === "out" ? !checkins.has(s.id) : true))
      .filter((s) => !n || norm(s.id).includes(n) || norm(s.last + s.first).includes(n) || norm(s.first + s.last).includes(n))
      .sort((a, b) => formatName(a).localeCompare(formatName(b)));
  }, [students, registered, checkins, filter, q]);

  return (
    <div className="flex flex-col gap-6">
      {/* Capacity band */}
      <section aria-labelledby="cap-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="cap-h" className="sr-only">Venue capacity</h2>
            <div className="flex items-baseline gap-3">
              <span className="font-bold" style={{ fontSize: "clamp(2.6rem,6vw,3.6rem)", lineHeight: 1 }}>{count}</span>
              <span className="text-lg muted">checked in of {CAPACITY} venue capacity</span>
            </div>
          </div>
          <button className="btn btn-gold" onClick={onOpenScanner}><ScanLine size={18} /> Open gate scanner</button>
        </div>
        <div className="capbar" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={CAPACITY} aria-label="Checked in versus capacity">
          <div className="capfill" style={{ width: `${Math.min(100, fill * 100)}%`, background: fillColor }} />
          <div className="captick" style={{ left: `${(registered.size / CAPACITY) * 100}%` }} title="Registered attendees" />
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
          {[
            ["Registered", registered.size, `${registered.size - count > 0 ? registered.size - count : 0} not yet arrived`],
            ["Show-up so far", pct(count / registered.size), "of registered students"],
            ["Last 10 minutes", `+${last10}`, "new check-ins"],
            ["Needs attention", attention.length, "unregistered, repeat, or unreadable scans"],
          ].map(([k, v, s]) => (
            <div key={k} style={{ borderLeft: "2px solid var(--line)", paddingLeft: ".8rem" }}>
              <dt className="text-sm muted">{k}</dt>
              <dd className="text-2xl font-bold">{v}</dd>
              <dd className="text-xs faint">{s}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6 min-w-0">
          <section className="panel p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">Arrivals every 5 minutes</h2>
              <span className="text-sm faint">Since {fmtTime(BASE)}</span>
            </div>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#263A69" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={{ fill: "#A3B1D0", fontSize: 12 }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(127,162,255,.08)" }} contentStyle={chartTip} formatter={(v) => [v, "Arrivals"]} />
                  <Bar dataKey="count" fill="#7FA2FF" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel flex flex-col min-w-0">
            <div className="p-4 md:p-5 flex flex-wrap gap-3 items-center justify-between">
              <h2 className="font-bold text-lg">Registered attendees</h2>
              <div className="seg" role="group" aria-label="Filter attendees">
                {[["all", `All ${registered.size}`], ["in", `Checked in ${count}`], ["out", `Not yet ${registered.size - Math.min(count, registered.size)}`]].map(([k, l]) => (
                  <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              <label className="field w-full">
                <Search size={17} />
                <input className="input" placeholder="Search by name or student number, e.g. pena or 2024-" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
            <div style={{ maxHeight: 420, overflow: "auto", borderTop: "1px solid var(--line)" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Name</th><th>Student number</th><th>Section</th><th>Status</th><th>Identified by</th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const c = checkins.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td className="font-bold">{formatName(s)}</td>
                        <td className="muted">{s.id}</td>
                        <td className="muted">{s.section}</td>
                        <td>{c ? <span className="chip in">In at {fmtTime(c.time)}</span> : <span className="faint">Not yet</span>}</td>
                        <td>{c ? <MethodChip method={c.method} confidence={c.confidence} /> : null}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={5} className="muted" style={{ padding: "1.5rem" }}>No registered attendee matches “{q}”. Check the spelling or try the student number.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="panel p-4 md:p-5 min-w-0" aria-labelledby="feed-h">
          <h2 id="feed-h" className="font-bold text-lg">Recent scans</h2>
          <p className="text-sm faint mb-2">Newest first, including scans that didn't check anyone in.</p>
          <ul className="feed" style={{ maxHeight: 760, overflow: "auto" }}>
            {log.slice(0, 18).map((l) => {
              const s = l.sid ? byId.get(l.sid) : null;
              return (
                <li key={l.uid}>
                  <OutcomeIcon outcome={l.outcome} />
                  <div className="min-w-0">
                    <div className="font-bold truncate">{s ? formatName(s) : "Unidentified ID"}</div>
                    <div className="text-sm muted">{OUTCOME_LABEL[l.outcome]}{s ? `, ${s.section}` : ""}</div>
                    {l.outcome === "approved" && <div className="mt-1"><MethodChip method={l.method} confidence={l.confidence} /></div>}
                  </div>
                  <time className="text-sm faint">{fmtTime(l.time)}</time>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ---------------- gate scanner ---------------- */
function useBeep(enabled) {
  const ctxRef = useRef(null);
  return (kind) => {
    if (!enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = ctxRef.current || (ctxRef.current = new Ctx());
      const tones = kind === "ok" ? [[880, 0, 0.13]] : kind === "attention" ? [[560, 0, 0.12], [560, 0.18, 0.12]] : [[220, 0, 0.3]];
      tones.forEach(([f, start, dur]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime + start;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      });
    } catch (e) { /* audio unavailable */ }
  };
}

function HoldToExit({ onExit }) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const begin = () => {
    const start = performance.now();
    const step = (t) => {
      const v = Math.min(1, (t - start) / 1200);
      setP(v);
      if (v >= 1) { setP(0); onExit(); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const cancel = () => { cancelAnimationFrame(raf.current); setP(0); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <button className="btn btn-sm hold" onPointerDown={begin} onPointerUp={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={cancel} aria-label="Hold to exit gate mode">
      <span className="fill" style={{ width: `${p * 100}%` }} />
      <Lock size={15} /> <span style={{ position: "relative" }}>Hold to exit gate mode</span>
    </button>
  );
}


/* ---------------- live camera ---------------- */
/* Opens the webcam and shows the feed. It does not decode anything yet:
   identification still runs through the demo scenarios below. */
function useCamera(enabled, deviceId) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("off"); // off | starting | live | denied | notfound | insecure | error
  const [detail, setDetail] = useState("");
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    if (!enabled) { stop(); setState("off"); return; }

    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // getUserMedia only exists on https or localhost
      setState("insecure");
      return;
    }

    setState("starting");
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try { await videoRef.current.play(); } catch (e) { /* autoplay guard */ }
        }
        setState("live");
        setDetail("");
        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setDevices(list.filter((d) => d.kind === "videoinput"));
        } catch (e) { /* labels need permission; ignore */ }
      })
      .catch((err) => {
        if (cancelled) return;
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
        else if (name === "NotFoundError" || name === "DevicesNotFoundError") setState("notfound");
        else if (name === "NotReadableError" || name === "TrackStartError") setState("error");
        else if (name === "OverconstrainedError") setState("notfound");
        else setState("error");
        setDetail((err && err.message) || String(err));
      });

    return () => { cancelled = true; stop(); };
  }, [enabled, deviceId]);

  const freeze = () => { if (videoRef.current) videoRef.current.pause(); };
  const resume = () => { if (videoRef.current && videoRef.current.paused) videoRef.current.play().catch(() => {}); };

  return { videoRef, state, detail, devices, freeze, resume };
}

function CameraStage({ cam, phase, card, glare, onRetry, onUseIllustration }) {
  const { videoRef, state, detail } = cam;
  const live = state === "live";
  const showIllustration = !live && state === "off" && card !== undefined && false; // reserved

  if (state === "starting") {
    return (
      <div className="vf-center">
        <div className="spin" aria-hidden="true" />
        <div className="text-lg font-bold">Starting camera</div>
        <p>macOS will ask for permission the first time. Choose Allow.</p>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera permission blocked</div>
        <ol>
          <li>1. Click the camera icon in the browser address bar and allow access for this site.</li>
          <li>2. If it still fails, open System Settings, Privacy &amp; Security, Camera, and switch your browser on.</li>
          <li>3. Reload the page, then start the camera again.</li>
        </ol>
        <div className="flex gap-2">
          <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
          <button className="btn btn-ghost" onClick={onUseIllustration}>Continue without camera</button>
        </div>
      </div>
    );
  }
  if (state === "notfound") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">No camera found</div>
        <p>Connect a webcam, or close any app already using it (Zoom, Photo Booth, Google Meet), then try again.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "insecure") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera needs a secure page</div>
        <p>Browsers only hand over the camera on https or on localhost. Open the app at http://localhost:5173 rather than a network address.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="vf-center">
        <CameraOff size={40} color="var(--warn)" />
        <div className="text-lg font-bold">Camera couldn't start</div>
        <p>{detail || "Another application may be holding the camera."}</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Try again</button>
      </div>
    );
  }
  if (state === "off") {
    return (
      <div className="vf-center">
        <CameraOff size={44} color="var(--warn)" />
        <div className="text-xl font-bold">Camera off</div>
        <p>Manual entry below still checks attendees in. Turn the camera back on when the hardware is ready.</p>
        <button className="btn" onClick={onRetry}><Camera size={16} /> Start camera</button>
      </div>
    );
  }
  return null;
}

const SCENARIOS = [
  ["clean", "Clean barcode read"],
  ["ocr", "Glare, OCR succeeds"],
  ["lowconf", "Glare, low-confidence OCR"],
  ["unreadable", "Unreadable ID"],
  ["notreg", "Not registered"],
  ["dup", "Already checked in"],
  ["full", "Venue at capacity (simulated)"],
];

function Scanner({ data, actions, gateMode, setGateMode }) {
  const { checkins } = data;
  const [phase, setPhase] = useState("idle"); // idle | barcode | ocr | result
  const [result, setResult] = useState(null);
  const [card, setCard] = useState(null);
  const [glare, setGlare] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [deviceId, setDeviceId] = useState(null);
  const cam = useCamera(cameraOn, deviceId);
  const live = cam.state === "live";
  const cameraUsable = cameraOn && cam.state !== "off";
  const [sound, setSound] = useState(true);
  const [path, setPath] = useState([]); // pipeline steps reached
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const timers = useRef([]);
  const beep = useBeep(sound);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => clearTimers, []);

  const reset = () => {
    clearTimers();
    setPhase("idle"); setResult(null); setCard(null); setGlare(false); setPath([]);
    cam.resume();
  };

  // Final decision after an ID has been resolved (Logical Layer rules)
  const decide = (student, method, confidence, opts = {}) => {
    const ev = actions.evaluate(student.id, opts);
    if (ev.outcome === "approved") {
      const time = actions.commit(student.id, method, confidence);
      setResult({ type: "approved", student, method, confidence, time });
      beep("ok");
      later(reset, 3500);
    } else {
      actions.logScan({ sid: student.id, outcome: ev.outcome, method });
      setResult({ type: ev.outcome, student, method, previous: ev.previous });
      beep(ev.outcome === "dup" ? "attention" : "error");
      if (ev.outcome === "dup") later(reset, 5000);
    }
    setPath((p) => [...p, "result"]);
    setPhase("result");
    cam.freeze();
  };

  const run = (kind) => {
    if (!cameraUsable) return;
    reset();
    const student = actions.pickFor(kind);
    const needsOcr = ["ocr", "lowconf", "unreadable"].includes(kind);
    setCard(student);
    setGlare(needsOcr);
    setPhase("barcode");
    setPath(["barcode"]);
    if (!needsOcr) {
      later(() => decide(student, "barcode", 1, { forceFull: kind === "full" }), 900);
      return;
    }
    later(() => { setPhase("ocr"); setPath(["barcode", "ocr"]); }, 1100);
    later(() => {
      setPath(["barcode", "ocr", "match"]);
      if (kind === "ocr") {
        decide(student, "ocr", 0.9 + Math.random() * 0.08);
      } else if (kind === "lowconf") {
        const read = misread(student.id);
        setResult({ type: "confirm", read, candidates: actions.candidates(read) });
        setPhase("result");
        beep("attention");
      } else {
        actions.logScan({ sid: null, outcome: "unresolved", method: "ocr" });
        setResult({ type: "unresolved" });
        setPhase("result");
        beep("error");
        setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
      }
    }, 2400);
  };

  const suggestions = actions.search(q);
  const chooseManual = (s) => {
    reset();
    setQ("");
    setCard(null);
    setPath(["manual"]);
    decide(s, "manual", null);
  };

  const busy = phase === "barcode" || phase === "ocr";
  const count = checkins.size;

  const stepState = (id) => {
    if (!path.length) return "";
    if (id === "result") return phase === "result" ? "active" : "";
    if (path.includes(id)) return path[path.length - 1] === id && phase !== "result" ? "active" : "done";
    return phase === "result" ? "skipped" : "";
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Gate header: event context and live headcount stay visible */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {gateMode && <div className="mark" aria-hidden="true" />}
          <div>
            <div className="text-sm muted">{gateMode ? EVENT.title : "Gate scanner"}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{count}</span>
              <span className="muted">of {CAPACITY} checked in</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} {sound ? "Sound on" : "Sound off"}
          </button>
          {cam.devices.length > 1 && live && (
            <select className="camselect" aria-label="Camera" value={deviceId || cam.devices[0].deviceId}
              onChange={(e) => { reset(); setDeviceId(e.target.value); }}>
              {cam.devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
              ))}
            </select>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => { reset(); setCameraOn((c) => !c); }}>
            {cameraOn ? <CameraOff size={16} /> : <Camera size={16} />} {cameraOn ? "Turn camera off" : "Turn camera on"}
          </button>
          {gateMode ? <HoldToExit onExit={() => setGateMode(false)} /> : (
            <button className="btn btn-sm btn-gold" onClick={() => setGateMode(true)}><Lock size={15} /> Enter gate mode</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Camera */}
        <div className="lg:col-span-3 min-w-0">
          <div className="viewfinder">
            <video ref={cam.videoRef} className={phase === "result" ? "frozen" : ""} autoPlay playsInline muted />

            {live ? (
              <>
                <div className="vf-status">
                  <span className="dot" style={{ background: "var(--ok)" }} /> Camera live
                </div>
                <div className="frame" aria-hidden="true">
                  <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                  {phase === "barcode" && <div className="sweep" />}
                </div>
                {phase === "ocr" && <div className="ocr-tag">Reading the printed student number</div>}
                {phase === "idle" && <div className="vf-note">Hold the ID inside the frame</div>}
                {phase === "result" && <div className="vf-note">Frame held</div>}
              </>
            ) : cameraOn && cam.state !== "starting" ? (
              <>
                {/* No feed: the illustrated ID keeps the demo scenarios legible */}
                <div className={`idcard ${card ? "" : "away"}`} aria-hidden="true">
                  <div className="band">UNIVERSITY STUDENT ID</div>
                  <div className="photo" />
                  <div className="info">
                    <div className="ln" style={{ width: "85%" }} />
                    <div className="ln" style={{ width: "60%" }} />
                    <div className={`num ${phase === "ocr" ? "reading" : ""}`}>{card ? card.id : "0000-00000"}</div>
                  </div>
                  <div className="bars" />
                  {glare && <div className="glare" />}
                </div>
                {phase === "idle" && (
                  <CameraStage cam={cam} onRetry={() => { setDeviceId(null); setCameraOn(false); setTimeout(() => setCameraOn(true), 60); }}
                    onUseIllustration={() => setCameraOn(false)} />
                )}
                {phase !== "idle" && (
                  <div className="frame" aria-hidden="true">
                    <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                    {phase === "barcode" && <div className="sweep" />}
                  </div>
                )}
                {phase === "ocr" && <div className="ocr-tag">Reading the printed student number</div>}
              </>
            ) : (
              <CameraStage cam={cam} onRetry={() => { setCameraOn(true); }} onUseIllustration={() => setCameraOn(false)} />
            )}
          </div>

        </div>

        {/* Result panel: sits right under the camera on small screens */}
        <div className="lg:col-span-2 lg:row-span-2 min-w-0" aria-live="assertive">
          <ResultPanel phase={phase} result={result} camera={cameraUsable} live={live} onReset={reset}
            onConfirm={(c) => decide(c.student, "confirmed", c.confidence)}
            onNone={() => { actions.logScan({ sid: null, outcome: "unresolved", method: "ocr" }); reset(); setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }}
            onManual={() => { reset(); setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }} />
        </div>

        {/* Pipeline + manual entry */}
        <div className="lg:col-span-3 flex flex-col gap-4 min-w-0">
          <ol className="steps" aria-label="Identification steps">
            {[["barcode", "Barcode"], ["ocr", "Student number (OCR)"], ["match", "Fuzzy match"], ["result", "Result"]].map(([id, label]) => (
              <li key={id} className={`step ${stepState(id)}`}>{label}</li>
            ))}
          </ol>

          <div className="panel p-4">
            <label htmlFor="manual" className="flex items-center gap-2 font-bold mb-2"><Keyboard size={17} /> Manual entry</label>
            <div className="field" style={{ position: "relative" }}>
              <Search size={17} />
              <input id="manual" ref={inputRef} className="input" autoComplete="off" value={q}
                placeholder="Type a student number or name, e.g. 2024- or dela cruz"
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (!suggestions.length) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === "Enter") { e.preventDefault(); chooseManual(suggestions[active]); }
                  if (e.key === "Escape") setQ("");
                }} />
              {q.length >= 2 && (
                <div className="suggest" role="listbox">
                  {suggestions.length ? suggestions.map((s, i) => (
                    <button key={s.id} role="option" aria-selected={i === active} data-active={i === active} onClick={() => chooseManual(s)}>
                      <span><span className="font-bold">{formatName(s)}</span> <span className="muted text-sm">{s.section}</span></span>
                      <span className="text-sm faint">{s.id}{actions.isRegistered(s.id) ? "" : ", not registered"}</span>
                    </button>
                  )) : <div className="p-3 muted">No student matches “{q}”.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <details className="demo panel p-4" open={!gateMode}>
        <summary>Demo scenarios for testing and presentations</summary>
        <div className="flex flex-wrap gap-2 mt-3">
          {SCENARIOS.map(([k, label]) => (
            <button key={k} className="btn btn-sm" disabled={busy || !cameraUsable || result?.type === "confirm"} onClick={() => run(k)}>{label}</button>
          ))}
        </div>
      </details>
    </div>
  );
}

function ResultPanel({ phase, result, camera, live, onReset, onConfirm, onNone, onManual }) {
  if (phase === "barcode" || phase === "ocr") {
    return (
      <div className="result idle">
        <div className="state"><ScanLine size={24} color="var(--gold)" /> {phase === "barcode" ? "Reading barcode" : "Barcode unreadable"}</div>
        <p className="muted text-lg">{phase === "barcode" ? "Keep the ID steady inside the frame." : "Reading the printed student number instead. Keep the ID still."}</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="result idle">
        <div className="state">{camera ? <ScanLine size={24} color="var(--gold)" /> : <AlertTriangle size={24} color="var(--warn)" />} {camera ? "Ready for the next attendee" : "Scanning paused"}</div>
        <p className="muted text-lg">{camera
          ? (live
            ? "Camera is live. Ask the attendee to hold their student ID inside the frame. Decoding is not wired up yet, so use a demo scenario to walk through a check-in."
            : "Ask the attendee to hold their student ID inside the frame. If the barcode can't be read, SELAE reads the printed student number.")
          : "The camera is off. Use manual entry to keep checking attendees in."}</p>
      </div>
    );
  }

  const Meta = ({ s }) => (
    <dl className="meta">
      <dt>Student number</dt><dd className="font-bold">{s.id}</dd>
      <dt>Section</dt><dd className="font-bold">{s.section}</dd>
    </dl>
  );

  switch (result.type) {
    case "approved":
      return (
        <div className="result ok">
          <div className="state"><CheckCircle2 size={28} /> Checked in</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">
            {result.method === "barcode" && "Identified by barcode"}
            {result.method === "ocr" && `Identified by OCR, ${pct(result.confidence)} match`}
            {result.method === "confirmed" && `Confirmed by operator, ${pct(result.confidence)} match`}
            {result.method === "manual" && "Entered manually"}
            {` at ${fmtTime(result.time)}`}
          </p>
          <div className="countdown" aria-hidden="true"><div style={{ animationDuration: "3.5s" }} /></div>
        </div>
      );
    case "dup":
      return (
        <div className="result dup">
          <div className="state"><History size={28} /> Already checked in</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">First checked in at {fmtTime(result.previous.time)} ({METHOD_LABEL[result.previous.method]}). No second entry was recorded.</p>
          <div className="countdown" aria-hidden="true"><div style={{ animationDuration: "5s" }} /></div>
        </div>
      );
    case "notreg":
      return (
        <div className="result bad">
          <div className="state"><XCircle size={28} /> Not registered for this event</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">This student isn't on the registration list. Send them to the registration desk.</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "full":
      return (
        <div className="result bad">
          <div className="state"><Ban size={28} /> Venue at capacity</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">The venue has reached its {CAPACITY}-person limit. Hold entry and notify an organizer before admitting anyone else.</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "confirm":
      return (
        <div className="result warn">
          <div className="state"><AlertTriangle size={28} /> Confirm this attendee</div>
          <p className="text-lg">The student number was hard to read. SELAE read <strong>{result.read}</strong>. Check the ID and choose the matching student.</p>
          <div className="flex flex-col gap-2">
            {result.candidates.map((c, i) => (
              <button key={c.student.id} className="cand" onClick={() => onConfirm(c)} autoFocus={i === 0}>
                <span>
                  <span className="font-bold text-lg block">{formatName(c.student)}</span>
                  <span>{c.student.id}, {c.student.section}</span>
                </span>
                <span className="font-bold">{pct(c.confidence)}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-on mt-auto" onClick={onNone}>None of these, type it instead</button>
        </div>
      );
    default:
      return (
        <div className="result warn">
          <div className="state"><HelpCircle size={28} /> Couldn't read this ID</div>
          <p className="text-lg">Neither the barcode nor the student number could be read. Type the student number or name in manual entry.</p>
          <button className="btn btn-on mt-auto" onClick={onManual}><Keyboard size={16} /> Go to manual entry</button>
        </div>
      );
  }
}

/* ---------------- analytics ---------------- */
const METHOD_COLOR = { barcode: "#7FA2FF", ocr: "#E4B23E", confirmed: "#F39A3D", manual: "#7384AB" };

function Analytics({ data, onToast }) {
  const { students, registered, checkins, log, now } = data;
  const attended = checkins.size;
  const reg = registered.size;

  const stats = useMemo(() => {
    const times = [...checkins.values()].map((c) => c.time.getTime()).sort((a, b) => a - b);
    let best = { count: 0, start: BASE.getTime() };
    for (let i = 0, j = 0; i < times.length; i++) {
      while (times[i] - times[j] >= 10 * 60000) j++;
      if (i - j + 1 > best.count) best = { count: i - j + 1, start: times[j] };
    }
    const methods = { barcode: 0, ocr: 0, confirmed: 0, manual: 0 };
    for (const c of checkins.values()) methods[c.method]++;
    let running = 0;
    const cumulative = arrivalBuckets(checkins, now, 5).map((b) => ({ label: b.label, total: (running += b.count) }));
    const bySection = SECTIONS.map((section) => {
      const inSec = students.filter((s) => s.section === section && registered.has(s.id));
      return { section, registered: inSec.length, attended: inSec.filter((s) => checkins.has(s.id)).length };
    });
    const failed = {
      notreg: log.filter((l) => l.outcome === "notreg").length,
      dup: log.filter((l) => l.outcome === "dup").length,
      unresolved: log.filter((l) => l.outcome === "unresolved").length,
      full: log.filter((l) => l.outcome === "full").length,
    };
    return { best, methods, cumulative, bySection, failed };
  }, [checkins, log, now, students, registered]);

  const { best, methods, cumulative, bySection, failed } = stats;
  const rescued = methods.ocr + methods.confirmed;

  const exportCsv = () => {
    const rows = [["Name", "Student number", "Section", "Checked in at", "Identified by"]];
    students
      .filter((s) => checkins.has(s.id))
      .sort((a, b) => formatName(a).localeCompare(formatName(b)))
      .forEach((s) => {
        const c = checkins.get(s.id);
        rows.push([formatName(s), s.id, s.section, fmtTime(c.time), METHOD_LABEL[c.method]]);
      });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    try {
      // BOM keeps ñ intact when the file is opened in Excel
      const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "selae-attendance.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast(`Exported ${attended} attendees`);
    } catch (e) {
      onToast("Export isn't available in this preview");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div style={{ maxWidth: 720 }}>
          <h2 className="font-bold" style={{ fontSize: "clamp(1.6rem,3.6vw,2.4rem)", lineHeight: 1.15 }}>
            {attended} of {reg} registered students checked in.
          </h2>
          <p className="text-lg muted mt-2">
            That's a {pct(attended / reg)} show-up rate. The busiest 10 minutes started at {fmtTime(new Date(best.start))}, with {best.count} arrivals.
            Figures update live while check-in is open.
          </p>
        </div>
        <button className="btn btn-gold" onClick={exportCsv}><Download size={18} /> Export attendance (CSV)</button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="panel p-4 md:p-5 min-w-0">
          <h3 className="font-bold text-lg">Check-ins over time</h3>
          <p className="text-sm faint mb-3">Running total against the {reg} registered students</p>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulative} margin={{ top: 10, right: 26, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="cum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7FA2FF" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#7FA2FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#263A69" strokeDasharray="3 4" />
                <XAxis dataKey="label" tick={{ fill: "#A3B1D0", fontSize: 12 }} axisLine={false} tickLine={false} interval={1} />
                <YAxis domain={[0, reg]} tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTip} formatter={(v) => [v, "Checked in"]} />
                <Area type="monotone" dataKey="total" stroke="#7FA2FF" strokeWidth={2.5} fill="url(#cum)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel p-4 md:p-5 min-w-0">
          <h3 className="font-bold text-lg">How attendees were identified</h3>
          <p className="mt-1 mb-4 muted">
            The OCR fallback identified <strong style={{ color: "var(--text)" }}>{rescued}</strong> attendees whose barcodes couldn't be read,
            {" "}{pct(rescued / Math.max(1, attended))} of all check-ins.
          </p>
          <div className="flex w-full overflow-hidden" style={{ height: 22, borderRadius: 999, background: "var(--bg)" }}
            role="img" aria-label={Object.entries(methods).map(([k, v]) => `${METHOD_LABEL[k]} ${v}`).join(", ")}>
            {Object.entries(methods).map(([k, v]) => (
              <div key={k} style={{ width: `${(v / Math.max(1, attended)) * 100}%`, background: METHOD_COLOR[k] }} />
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5">
            {Object.entries(methods).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: METHOD_COLOR[k], flexShrink: 0 }} />
                <dt className="muted flex-1">{METHOD_LABEL[k]}</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 pt-4 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="font-bold mb-1">Scans that didn't check anyone in</div>
            <p className="muted">
              {failed.notreg} unregistered, {failed.dup} repeat scans blocked, {failed.unresolved} unreadable
              {failed.full ? `, ${failed.full} turned away at capacity` : ""}.
            </p>
          </div>
        </section>

        <section className="panel p-4 md:p-5 min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="font-bold text-lg">Attendance by section</h3>
            <div className="flex gap-4 text-sm muted">
              <span className="flex items-center gap-2"><span style={{ width: 12, height: 12, borderRadius: 3, background: "#34497D" }} /> Registered</span>
              <span className="flex items-center gap-2"><span style={{ width: 12, height: 12, borderRadius: 3, background: "#7FA2FF" }} /> Checked in</span>
            </div>
          </div>
          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySection} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }} barGap={-14} barCategoryGap="28%">
                <CartesianGrid horizontal={false} stroke="#263A69" strokeDasharray="3 4" />
                <XAxis type="number" tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="section" width={78} tick={{ fill: "#A3B1D0", fontSize: 13 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(127,162,255,.06)" }} contentStyle={chartTip}
                  formatter={(v, name) => [v, name === "attended" ? "Checked in" : "Registered"]} />
                <Bar dataKey="registered" fill="#34497D" barSize={14} radius={[0, 5, 5, 0]} />
                <Bar dataKey="attended" fill="#7FA2FF" barSize={14} radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

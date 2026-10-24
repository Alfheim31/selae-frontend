import crypto from "node:crypto";
import { rng as simRng, makeWorld, simulateHistory } from "./simulate.js";

/* ------------------------------------------------------------------
   First-run data: a student directory, a semester of simulated past
   events (so the turnout forecast has history to learn from), one demo
   event that is already 42 minutes into check-in, and an upcoming
   workshop that is oversubscribed, with a waitlist. Same seeded generator as the original
   prototype, so the names and student numbers are stable.
------------------------------------------------------------------- */

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

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to misread
export function newCode(len = 10) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export function newId() {
  return crypto.randomBytes(5).toString("hex");
}
export const hashKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");

export function buildSeed(now) {
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
    students.push({ id, section, last: pick(SURNAMES), first: pick(GIVEN), middle: r() < 0.1 ? "" : pick(MIDDLES),
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

  const opened = new Date(now.getTime() - 42 * 60000);
  const event = {
    id: "demo-ga",
    title: "CS Department General Assembly",
    description: "Kick-off assembly for all BSCS students: org updates, the semester calendar, and the officer line-up. Bring your student ID; check-in is at the gymnasium entrance.",
    startsAt: opened.toISOString(),
    endsAt: new Date(opened.getTime() + 3 * 3600000).toISOString(),
    venue: "University Gymnasium",
    capacity: 200,
    color: "gold",
    visibility: "public",
    registrationOpen: true,
    hostName: "CS Student Council",
    hostKeyHash: hashKey(crypto.randomBytes(16).toString("hex")), // managed from the server laptop only
    createdAt: new Date(opened.getTime() - 7 * 86400000).toISOString(),
  };

  const at = (min) => new Date(opened.getTime() + min * 60000 + Math.floor(r() * 59) * 1000).toISOString();
  const registered = students.slice(0, 180);
  const registrations = registered.map((s) => ({
    id: newId(), eventId: event.id, code: newCode(), studentId: s.id, email: "", status: "going",
    createdAt: new Date(opened.getTime() - Math.floor(r() * 6 * 86400000)).toISOString(), checkin: null,
  }));

  // Shuffle, then check in 128 with a peak around 22 minutes after opening
  const order = registrations.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const logs = [];
  order.slice(0, 128).forEach((reg) => {
    const min = Math.min(41, Math.max(0, 22 + (r() + r() + r() - 1.5) * 17));
    const roll = r();
    const method = roll < 0.78 ? "qr" : roll < 0.91 ? "ocr" : roll < 0.96 ? "confirmed" : "manual";
    const confidence = method === "qr" ? 1 : method === "ocr" ? 0.9 + r() * 0.09 : method === "confirmed" ? 0.62 + r() * 0.16 : null;
    reg.checkin = { time: at(min), method, confidence };
    logs.push({ uid: newId(), eventId: event.id, time: reg.checkin.time, studentId: reg.studentId, outcome: "approved", method, confidence });
  });
  students.slice(180, 186).forEach((s) => logs.push({ uid: newId(), eventId: event.id, time: at(5 + r() * 36), studentId: s.id, outcome: "notreg", method: "barcode" }));
  order.slice(0, 3).forEach((reg) => {
    const t = Math.min(new Date(reg.checkin.time).getTime() + 6 * 60000, opened.getTime() + 41.5 * 60000);
    logs.push({ uid: newId(), eventId: event.id, time: new Date(t).toISOString(), studentId: reg.studentId, outcome: "dup", method: "qr" });
  });
  logs.push({ uid: newId(), eventId: event.id, time: at(31), studentId: null, outcome: "unresolved", method: "ocr" });

  // A semester of past events. Separate random stream, so the names and numbers above don't change.
  const hr = simRng(2026);
  const world = makeWorld(students, hr);
  const history = simulateHistory({ students, now, r: hr, world, count: 14, spacingDays: 6, endDaysAgo: 3, newId, newCode });
  const hidden = ({ _p, _effect, ...rest }) => rest; // the simulator's ground truth stays out of the data file
  history.events.forEach((e) => { e.hostKeyHash = hashKey(crypto.randomBytes(16).toString("hex")); });

  // An upcoming workshop with more sign-ups than seats: the case the waitlist release is for
  const wsStart = new Date(now.getTime() + 2 * 86400000);
  if (wsStart.getDay() === 0) wsStart.setDate(wsStart.getDate() + 1);
  if (wsStart.getDay() === 6) wsStart.setDate(wsStart.getDate() + 2);
  wsStart.setHours(13, 0, 0, 0);
  const workshop = {
    id: "ml-workshop",
    title: "Intro to Machine Learning Workshop",
    description: "A hands-on afternoon building your first classifier in Python. Laptops provided; seats are limited to the lab's 60 workstations.",
    startsAt: wsStart.toISOString(),
    endsAt: new Date(wsStart.getTime() + 3 * 3600000).toISOString(),
    venue: "CISTM Computer Lab 1",
    capacity: 60,
    color: "violet",
    visibility: "public",
    registrationOpen: true,
    hostName: "GDG on Campus PLM",
    hostKeyHash: hashKey(crypto.randomBytes(16).toString("hex")),
    createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
  };
  const wsPool = students.slice().sort(() => hr() - 0.5).slice(0, 112);
  const wsRegs = wsPool.map((s) => ({
    id: newId(), eventId: workshop.id, code: newCode(), studentId: s.id, email: "", status: "going",
    createdAt: new Date(Math.min(now.getTime() - 3600000, wsStart.getTime() - (0.3 + -Math.log(1 - hr()) * 3) * 86400000)).toISOString(),
    checkin: null,
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  wsRegs.forEach((reg, k) => { if (k >= workshop.capacity) reg.status = "waitlist"; });

  return {
    rev: 1,
    directory: Object.fromEntries(students.map((s) => [s.id, s])),
    events: [...history.events.map(hidden), event, workshop],
    registrations: [...history.registrations.map(hidden), ...registrations, ...wsRegs],
    logs: [...history.logs, ...logs],
  };
}

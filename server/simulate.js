/* ------------------------------------------------------------------
   Simulated event history, for training and testing the turnout model
   (server/forecast.js) before SELAE has run real events.

   Every student has a hidden "reliability" (some people show up to
   everything, some register for everything and come to little). Each
   registration's true chance of showing up also depends on things
   SELAE can see: how far ahead they registered, their year level, the
   time of day and day of week, and whether they got in off the
   waitlist. The turnout model never sees these rules or the hidden
   reliability; it only sees who came to past events, and has to learn
   the pattern from that.

   Used by seed.js (a semester of past events for the demo) and by
   scripts/eval-turnout.js (a longer history to test against).
------------------------------------------------------------------- */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Year level from a section like "BSCS 3-4" (0 if it can't tell). */
export function yearOf(section) {
  const m = String(section || "").match(/(\d)\s*-\s*\d/);
  return m ? Number(m[1]) : 0;
}

/** The hidden part of the world: each student's reliability and how often they register. */
export function makeWorld(students, r) {
  const people = new Map();
  for (const s of students) {
    const reliability = gauss(r);
    // People who register for lots of things are a little less reliable on average
    const keenness = Math.exp(0.6 * gauss(r) - 0.25 * reliability);
    people.set(s.id, { reliability, keenness });
  }
  return { people };
}

/** The true chance this registration turns up. Only the simulator knows this. */
export function trueShowProb(world, student, event, reg) {
  const p = world.people.get(student.id) || { reliability: 0 };
  const start = new Date(event.startsAt);
  const leadDays = Math.max(0, (start - new Date(reg.createdAt)) / 86400000);
  const hour = start.getHours(), day = start.getDay();
  const year = yearOf(student.section);
  const z = 1.5
    + 1.3 * p.reliability
    - 0.4 * Math.log1p(leadDays)
    + 0.45 * (leadDays < 1)
    + 0.25 * (year === 1) - 0.5 * (year === 4)
    - 0.6 * (hour < 9) - 0.45 * (hour >= 17)
    - 0.35 * (day === 5)
    - 0.7 * Boolean(reg.promotedAt)
    + (event._effect || 0);
  return sigmoid(z);
}

/** Minutes after the start an attendee arrives: a few early, most in the first half hour, a long late tail. */
export function arrivalOffset(r) {
  const u = r();
  if (u < 0.15) return -20 * r();
  if (u < 0.85) return Math.max(-5, 12 + 11 * gauss(r));
  return 25 + 40 * -Math.log(1 - r() * 0.95);
}

const TITLES = [
  ["Python Crash Course", "GDG on Campus PLM", "CISTM Computer Lab 3"],
  ["Resume and LinkedIn Clinic", "CS Student Council", "Gusaling Lacson, Room 301"],
  ["Hack Night: Build a Discord Bot", "GDG on Campus PLM", "CISTM Computer Lab 1"],
  ["Thesis Writing Workshop", "CS Department", "Gusaling Villegas, AVR"],
  ["Cybersecurity 101", "CS Student Council", "CISTM Computer Lab 2"],
  ["UI/UX Design Jam", "GDG on Campus PLM", "Innovation Hub"],
  ["Intro to Git and GitHub", "GDG on Campus PLM", "CISTM Computer Lab 3"],
  ["Career Talk: Life in Big Tech", "CS Department", "University Gymnasium"],
  ["Data Science Study Group", "CS Student Council", "Library Discussion Room"],
  ["Mobile Dev with Flutter", "GDG on Campus PLM", "CISTM Computer Lab 1"],
  ["Algorithms Review Session", "CS Student Council", "Gusaling Lacson, Room 204"],
  ["Cloud Study Jam", "GDG on Campus PLM", "Innovation Hub"],
];
const HOURS = [8, 10, 10, 13, 13, 15, 15, 17, 18];
const CAPACITIES = [40, 50, 60, 80, 100, 120];

/**
 * Generate `count` past events, oldest first, ending `endDaysAgo` days before `now`.
 * `ids` and `codes` make the ids and ticket codes (seed.js passes its own so they match the rest of the data).
 * Returns { events, registrations, logs }; registrations include `_p`, the true show-up chance, for evaluation only.
 */
export function simulateHistory({ students, now, r, world, count = 10, spacingDays = 7, endDaysAgo = 4, newId, newCode, idPrefix = "sim", demand: [dLo, dHi] = [0.7, 1.45] }) {
  const events = [], registrations = [], logs = [];
  const pick = (a) => a[Math.floor(r() * a.length)];
  const byId = new Map(students.map((s) => [s.id, s]));

  for (let i = 0; i < count; i++) {
    const daysAgo = endDaysAgo + (count - 1 - i) * spacingDays + Math.floor(r() * 3);
    const start = new Date(now.getTime() - daysAgo * 86400000);
    if (start.getDay() === 0) start.setDate(start.getDate() + 1);
    if (start.getDay() === 6) start.setDate(start.getDate() - 1);
    start.setHours(pick(HOURS), 0, 0, 0);
    const [title, hostName, venue] = TITLES[i % TITLES.length];
    const capacity = pick(CAPACITIES);
    const event = {
      id: `${idPrefix}-${i + 1}`, title, hostName, venue, capacity,
      description: "A past event from SELAE's simulated history, used to train the turnout forecast.",
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * 3600000).toISOString(),
      color: pick(["gold", "blue", "green", "rose", "violet", "teal"]), visibility: "public", registrationOpen: true,
      createdAt: new Date(start.getTime() - 16 * 86400000).toISOString(), simulated: true,
      _effect: 0.3 * gauss(r),
    };
    events.push(event);

    // Who registers: some events are oversubscribed, some aren't
    const demand = Math.min(students.length, Math.round(capacity * (dLo + (dHi - dLo) * r())));
    const weighted = students.map((s) => ({ s, w: world.people.get(s.id).keenness * -Math.log(1 - r()) }))
      .sort((a, b) => b.w - a.w).slice(0, demand);
    const regs = weighted.map(({ s }) => {
      const leadDays = Math.min(14, -Math.log(1 - r()) * 3.2);
      return { id: newId(), eventId: event.id, code: newCode(), studentId: s.id, email: "", status: "going",
        createdAt: new Date(start.getTime() - leadDays * 86400000 - r() * 3600000).toISOString(), checkin: null };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    regs.forEach((reg, k) => { if (k >= capacity) reg.status = "waitlist"; });

    // A few cancel before the day; the longest-waiting person moves up
    for (const reg of regs) {
      if (reg.status !== "going" || r() > 0.05) continue;
      reg.status = "cancelled";
      const next = regs.find((x) => x.status === "waitlist");
      if (next) { next.status = "going"; next.promotedAt = new Date(start.getTime() - r() * 2 * 86400000).toISOString(); }
    }

    for (const reg of regs) {
      reg._p = trueShowProb(world, byId.get(reg.studentId), event, reg);
      if (reg.status !== "going" || r() >= reg._p) continue;
      const time = new Date(start.getTime() + arrivalOffset(r) * 60000).toISOString();
      const roll = r();
      const method = roll < 0.8 ? "qr" : roll < 0.92 ? "ocr" : roll < 0.96 ? "confirmed" : "manual";
      const confidence = method === "qr" ? 1 : method === "ocr" ? 0.9 + r() * 0.09 : method === "confirmed" ? 0.62 + r() * 0.16 : null;
      reg.checkin = { time, method, confidence };
      logs.push({ uid: newId(), eventId: event.id, time, studentId: reg.studentId, outcome: "approved", method, confidence });
    }
    registrations.push(...regs);
  }
  return { events, registrations, logs };
}

#!/usr/bin/env node
/* ------------------------------------------------------------------
   Evaluates the turnout forecast and waitlist release (server/forecast.js).

   npm run eval:turnout
     Simulates several separate "worlds" (default 5), each a long history of oversubscribed events (server/simulate.js:
     every student has a hidden reliability, and the true show-up chance
     depends on things the model can and can't see). Then walks forward
     through the last events one at a time: train on everything that
     finished before the event, predict it, compare with what happened.

     1. Prediction: who comes, against two simpler predictors
          - the average show-up rate of past events
          - each person's own past show-up rate
     2. Decision: how many people to let in off the waitlist, against
          - no release (only cancellations free a seat; what SELAE did before)
          - a fixed 15% overbook
          - capacity divided by the average show-up rate
          - the forecast without event-level swings (attendees independent)
        Each policy is replayed many times on the true show-up chances,
        counting empty seats and people turned away at the gate.

   Options: --worlds 5  --events 40  --test 12  --students 400  --seed 11  --runs 400
------------------------------------------------------------------- */
import crypto from "node:crypto";
import { rng, makeWorld, simulateHistory, trueShowProb } from "../server/simulate.js";
import { trainTurnout, predictEvent, forecastNow, auc, brier, logLoss } from "../server/forecast.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const EVENTS = Number(args.events) || 40, TEST = Number(args.test) || 12, STUDENTS = Number(args.students) || 400;
const RUNS = Number(args.runs) || 400, SEED = Number(args.seed) || 11;

const WORLDS = Number(args.worlds) || 5;
const newId = () => crypto.randomBytes(5).toString("hex");
const newCode = () => crypto.randomBytes(5).toString("hex").toUpperCase();
const SECTIONS = ["BSCS 1-1", "BSCS 1-2", "BSCS 2-1", "BSCS 2-2", "BSCS 3-1", "BSCS 3-2", "BSCS 3-4", "BSCS 4-1", "BSCS 4-2"];

const rowsModel = [], rowsBase = [], rowsPast = [], ys = [];
const policies = {
  "No release (before)": [], "Fixed 15% overbook": [], "Capacity / average rate": [], "Independent only, 5% risk": [],
  "Forecast, 1% risk": [], "Forecast, 5% risk": [], "Forecast, 10% risk": [],
};

for (let world_i = 0; world_i < WORLDS; world_i++) {
  const r = rng(SEED + world_i * 1000);
  const students = Array.from({ length: STUDENTS }, (_, i) => {
    const section = SECTIONS[Math.floor(r() * SECTIONS.length)];
    return { id: `20${20 + (i % 6)}-${String(10000 + i).padStart(5, "0")}`, section, first: "S", last: String(i), middle: "", suffix: "" };
  });
  const world = makeWorld(students, r);
  const now = new Date();
  const hist = simulateHistory({ students, now, r, world, count: EVENTS, spacingDays: 4, endDaysAgo: 2, newId, newCode, demand: [1.6, 2.6] });
  const data = {
    directory: Object.fromEntries(students.map((s) => [s.id, s])),
    events: hist.events, registrations: hist.registrations, logs: hist.logs,
  };
  const byId = new Map(students.map((s) => [s.id, s]));

  const testEvents = hist.events.slice(-TEST);

  for (const event of testEvents) {
    // What SELAE would know the day before: everything that finished earlier, no outcomes for this event
    const asOf = new Date(new Date(event.startsAt).getTime() - 86400000);
    const model = trainTurnout(data, asOf);
    const regs = data.registrations.filter((x) => x.eventId === event.id && x.status !== "cancelled");
    const preds = predictEvent(model, data, event);

    // 1. Prediction quality on the people who were going (their outcome is known)
    for (const reg of regs.filter((x) => x.status === "going")) {
      const h = (model.hist.get(reg.studentId) || []).filter((e) => e.start < new Date(event.startsAt).getTime());
      rowsModel.push(preds[reg.id].p);
      rowsBase.push(model.baseRate);
      rowsPast.push((h.filter((e) => e.came).length + 1) / (h.length + 2));
      ys.push(reg.checkin ? 1 : 0);
    }

    // 2. Decisions, replayed against the true show-up chances (waitlisted people as if they'd been let in)
    const going = regs.filter((x) => x.status === "going");
    const waitlist = regs.filter((x) => x.status === "waitlist").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const truth = (reg, promoted) => trueShowProb(world, byId.get(reg.studentId), event,
      promoted ? { ...reg, promotedAt: reg.promotedAt || asOf.toISOString() } : reg);
    const pGoing = going.map((x) => truth(x, false)), pWait = waitlist.map((x) => truth(x, true));
    const plain = regs.map(({ checkin, ...x }) => ({ ...x, checkin: null }));
    const fc = (risk) => forecastNow({ capacity: event.capacity, startsAt: event.startsAt, endsAt: event.endsAt,
      regs: plain, preds, arrival: model.arrival, spread: model.spread, now: asOf, risk }).release;
    const fcIndependent = (risk) => forecastNow({ capacity: event.capacity, startsAt: event.startsAt, endsAt: event.endsAt,
      regs: plain, preds, arrival: model.arrival, spread: 0, now: asOf, risk }).release;
    const choices = {
      "No release (before)": 0,
      "Fixed 15% overbook": Math.round(event.capacity * 0.15),
      "Capacity / average rate": Math.max(0, Math.floor(event.capacity / model.baseRate) - going.length),
      "Independent only, 5% risk": fcIndependent(0.05),
      "Forecast, 1% risk": fc(0.01), "Forecast, 5% risk": fc(0.05), "Forecast, 10% risk": fc(0.1),
    };
    for (const [name, k0] of Object.entries(choices)) {
      const k = Math.min(k0, waitlist.length);
      const probs = [...pGoing, ...pWait.slice(0, k)];
      let empty = 0, away = 0, overflowRuns = 0;
      for (let run = 0; run < RUNS; run++) {
        let came = 0;
        for (const p of probs) if (r() < p) came++;
        empty += Math.max(0, event.capacity - came);
        away += Math.max(0, came - event.capacity);
        overflowRuns += came > event.capacity;
      }
      policies[name].push({ k, cap: event.capacity, empty: empty / RUNS, away: away / RUNS, overflow: overflowRuns / RUNS });
    }
  }
}

/* ---------- report ---------- */
const f = (v, d = 3) => v.toFixed(d);
const pctS = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`\nTurnout forecast, walk-forward over the last ${TEST} of ${EVENTS} events in each of ${WORLDS} simulated worlds (${STUDENTS} students each, seed ${SEED})`);
console.log(`${ys.length} registrations predicted; ${pctS(ys.reduce((a, b) => a + b, 0) / ys.length)} actually came.\n`);
console.log("1. Who comes                       AUC     Brier   Log loss");
console.log(`   Average past rate               0.500*   ${f(brier(rowsBase, ys))}   ${f(logLoss(rowsBase, ys))}`);
console.log(`   Own past rate only              ${f(auc(rowsPast, ys))}   ${f(brier(rowsPast, ys))}   ${f(logLoss(rowsPast, ys))}`);
console.log(`   Logistic regression (SELAE)     ${f(auc(rowsModel, ys))}   ${f(brier(rowsModel, ys))}   ${f(logLoss(rowsModel, ys))}`);

console.log("\n2. Waitlist release                Released  Empty seats  Seats filled  Events with overflow  Turned away");
for (const [name, rows] of Object.entries(policies)) {
  const n = rows.length;
  const avg = (k) => rows.reduce((s, x) => s + x[k], 0) / n;
  const filled = rows.reduce((s, x) => s + (x.cap - x.empty), 0) / rows.reduce((s, x) => s + x.cap, 0);
  console.log(`   ${name.padEnd(30)}  ${f(avg("k"), 1).padStart(8)}  ${f(avg("empty"), 1).padStart(11)}  ${pctS(filled).padStart(12)}  ${pctS(avg("overflow")).padStart(20)}  ${f(avg("away"), 2).padStart(11)}`);
}
console.log("\n   Per event, averaged over", RUNS, "replays of who shows up. \"Events with overflow\": chance more people come than seats.");
console.log("   * One rate for everyone can't rank people, so its AUC is 0.5 by definition.");
console.log("   The forecast's overflow should land near the risk picked. Treating attendees as independent understates it.\n");

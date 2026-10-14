#!/usr/bin/env node
/* ------------------------------------------------------------------
   Evaluates the OCR matcher (server/matcher.js) against a baseline.

   Synthetic mode (default): npm run eval
     Builds a student directory and an event guest list, simulates
     attendees arriving and OCR misreading their numbers under glare,
     and compares three matchers on the same reads:
       - Baseline: nearest student number by plain edit distance
         (what the earlier prototype did), auto-accepting a unique
         match within one edit
       - Bayesian, before learning: the matcher with its starting beliefs
       - Bayesian, after learning: the same matcher after operators
         corrected a separate batch of reads at this "venue"

   Real-data mode: npm run eval -- --csv reads.csv --roster roster.txt
     reads.csv:   read,truth[,conf]   one OCR read per line, the true
                  student number, and optionally the per-digit OCR
                  confidences separated by spaces (0..1)
     roster.txt:  the student numbers registered for the event, one per line
     The first half of the reads is used for learning, the second half
     for testing, so "after learning" is measured on unseen reads.

   Options: --n 600 (test reads)  --train 400 (reads operators see while it learns)  --seed 7  --json out.json
------------------------------------------------------------------- */
import fs from "node:fs";
import { rank, learn, emptyModel, PRIOR_WEIGHT, digitsOf, CONFUSABLE } from "../server/matcher.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));

/* ---------- seeded randomness ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(Number(args.seed) || 7);
const pick = (a) => a[Math.floor(R() * a.length)];
const between = (a, b) => a + R() * (b - a);

/* ---------- baseline: plain edit distance ---------- */
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function baseline(guests, read) {
  const scored = guests.map((id) => ({ id, d: lev(digitsOf(id), read) })).sort((a, b) => a.d - b.d);
  const [first, second] = scored;
  const unique = !second || second.d > first.d;
  const decision = unique && first.d <= 1 ? "auto" : "confirm";
  return { decision, ranked: scored.slice(0, 3).map((x) => x.id) };
}

/* ---------- the venue's real OCR behaviour (unknown to the matcher) ---------- */
// Under this venue's lights and this batch of cards, a few confusions dominate,
// and most are NOT the ones the matcher starts out expecting (see CONFUSABLE in
// matcher.js). That is the situation learning from corrections is for.
const VENUE = { errorRate: 0.11, deletion: 0.015, insertion: 0.01,
  favourites: { 4: [7], 0: [2], 8: [0], 6: [0], 7: [4], 1: [4, 7], 3: [9], 9: [3], 5: [3], 2: [0] } };
function ocr(trueId) {
  const t = digitsOf(trueId);
  const read = [], conf = [];
  for (const ch of t) {
    if (R() < VENUE.insertion) { read.push(String(Math.floor(R() * 10))); conf.push(between(0.2, 0.6)); }
    if (R() < VENUE.deletion) continue;
    if (R() < VENUE.errorRate) {
      const fav = VENUE.favourites[ch];
      const wrong = fav && R() < 0.8 ? pick(fav) : (+ch + 1 + Math.floor(R() * 9)) % 10;
      read.push(String(wrong));
      conf.push(between(0.3, 0.85)); // OCR is often still fairly sure when wrong
    } else {
      read.push(ch);
      conf.push(between(0.7, 0.99));
    }
  }
  return { read: read.join(""), conf };
}

/* ---------- metrics ---------- */
function score(name, results) {
  const n = results.length;
  const onFile = results.filter((r) => r.onFile);
  const auto = results.filter((r) => r.decision === "auto");
  const autoWrong = auto.filter((r) => r.ranked[0] !== r.truth);
  return {
    matcher: name,
    reads: n,
    "top-1 right": onFile.filter((r) => r.ranked[0] === r.truth).length / onFile.length,
    "top-3 right": onFile.filter((r) => r.ranked.includes(r.truth)).length / onFile.length,
    "decided alone": auto.length / n,
    "wrong when alone": auto.length ? autoWrong.length / auto.length : 0,
    "asked operator": results.filter((r) => r.decision === "confirm").length / n,
    "sent to manual": results.filter((r) => r.decision === "reject").length / n,
  };
}

function runBayes(people, cases, model) {
  return cases.map((c) => {
    const out = rank(people, c.read, c.conf, model);
    if (process.env.DEBUG && out.decision === "auto" && out.top.id !== c.truth) console.log("WRONG", c.truth, c.onFile, c.read, c.conf.map((x) => x.toFixed(2)).join(" "), out.top.id, out.top.p.toFixed(3));
    return { ...c, decision: out.decision, ranked: out.candidates.map((x) => x.id) };
  });
}

function runBaseline(guests, cases) {
  return cases.map((c) => ({ ...c, ...baseline(guests, c.read) }));
}

/** Operators resolve reads the matcher wasn't sure about; those answers are what it learns from. */
function trainOn(people, cases, model) {
  for (const c of cases) {
    const out = rank(people, c.read, c.conf, model);
    if (out.decision !== "auto" && c.onFile) learn(model, c.read, c.truth);
  }
  return model;
}

function printTable(rows) {
  const keys = Object.keys(rows[0]);
  const fmt = (k, v) => (typeof v === "number" && k !== "reads" ? `${(v * 100).toFixed(1)}%` : String(v));
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => fmt(k, r[k]).length)));
  const line = (vals) => vals.map((v, i) => (i === 0 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join("  ");
  console.log(line(keys));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(keys.map((k) => fmt(k, r[k]))));
}

/* ---------- synthetic venue ---------- */
function synthetic() {
  const N = Number(args.n) || 600, TRAIN = args.train !== undefined ? Number(args.train) : 400;
  const ids = new Set();
  while (ids.size < 2000) ids.add(`${2019 + Math.floor(R() * 8)}-${String(Math.floor(R() * 100000)).padStart(5, "0")}`);
  const directory = [...ids];
  const shuffled = [...directory].sort(() => R() - 0.5);
  const going = shuffled.slice(0, 300), inside = going.slice(0, 60), expected = going.slice(60);
  const waitlist = shuffled.slice(300, 330);
  const notOnFile = Array.from({ length: 200 }, () => `${2019 + Math.floor(R() * 8)}-${String(Math.floor(R() * 100000)).padStart(5, "0")}`)
    .filter((id) => !ids.has(id));

  const weight = (id) => (inside.includes(id) ? PRIOR_WEIGHT.inside : expected.includes(id) ? PRIOR_WEIGHT.expected
    : waitlist.includes(id) ? PRIOR_WEIGHT.waitlist : PRIOR_WEIGHT.stranger);
  const people = directory.map((id) => ({ id, weight: weight(id) }));

  // Who walks up to the gate: mostly expected guests, some repeats, some who never registered or aren't on file
  const arrival = () => {
    const x = R();
    if (x < 0.86) return { truth: pick(expected), onFile: true };
    if (x < 0.92) return { truth: pick(inside), onFile: true };
    if (x < 0.96) return { truth: pick(directory), onFile: true };
    return { truth: pick(notOnFile), onFile: false };
  };
  const make = (n) => Array.from({ length: n }, () => { const a = arrival(); return { ...a, ...ocr(a.truth) }; });
  const train = make(TRAIN), test = make(N);

  console.log(`\nSynthetic venue: ${directory.length} students on file, ${going.length} going (${inside.length} already inside),`);
  console.log(`${N} test reads at a ${(VENUE.errorRate * 100).toFixed(0)}% per-digit OCR error rate, ${TRAIN} reads used for learning.\n`);

  const learned = trainOn(people, train, emptyModel());
  return {
    rows: [
      score("Baseline (edit distance)", runBaseline(going, test)),
      score("Bayesian, before learning", runBayes(people, test, emptyModel())),
      score(`Bayesian, after ${learned.corrections} corrections`, runBayes(people, test, learned)),
    ],
    sweep: () => sweep(people, test, learned),
  };
}

/* How the auto-identify threshold trades operator workload against mistakes */
function sweep(people, test, model) {
  return [0.8, 0.9, 0.95, 0.99].map((autoAt) => {
    const m = { ...model, thresholds: { ...model.thresholds, autoAt } };
    const s = score(`autoAt ${autoAt}`, runBayes(people, test, m));
    return { threshold: `decide alone at ${Math.round(autoAt * 100)}%`, "decided alone": s["decided alone"], "wrong when alone": s["wrong when alone"], "asked operator": s["asked operator"] };
  });
}

/* ---------- real reads from photographed IDs ---------- */
function real() {
  const roster = fs.readFileSync(args.roster, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const rows = fs.readFileSync(args.csv, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^read\s*,/i.test(l));
  const cases = rows.map((l) => {
    const [read, truth, conf] = l.split(",").map((s) => s.trim());
    const c = conf ? conf.split(/\s+/).map(Number) : null;
    return { read: digitsOf(read), truth: `${digitsOf(truth).slice(0, 4)}-${digitsOf(truth).slice(4)}`, conf: c, onFile: true };
  });
  const people = roster.map((id) => ({ id, weight: PRIOR_WEIGHT.expected }));
  cases.forEach((c) => { if (!roster.includes(c.truth)) c.onFile = false; });
  const half = Math.floor(cases.length / 2);
  const train = cases.slice(0, half), test = cases.slice(half);
  const learned = trainOn(people, train, emptyModel());
  console.log(`\nReal reads: ${cases.length} (${train.length} for learning, ${test.length} for testing), roster of ${roster.length}.\n`);
  return {
    rows: [
      score("Baseline (edit distance)", runBaseline(roster, test)),
      score("Bayesian, before learning", runBayes(people, test, emptyModel())),
      score(`Bayesian, after ${learned.corrections} corrections`, runBayes(people, test, learned)),
    ],
    sweep: () => sweep(people, test, learned),
  };
}

const result = args.csv && args.roster ? real() : synthetic();
const table = result.rows;
printTable(table);
console.log("\nThreshold for deciding without the operator (learned model):\n");
const sweepRows = result.sweep();
printTable(sweepRows);
console.log(`
top-1 / top-3 right   the true student is SELAE's first choice / in its top three (people on file only)
decided alone         share of reads identified with no operator involved
wrong when alone      of those, how often it picked the wrong person (the number to keep near zero)
asked operator        share shown to the operator as a short list to confirm
sent to manual        share the matcher refused to guess on
Confusions the matcher starts out expecting: ${CONFUSABLE.map(([a, b]) => `${a}/${b}`).join(", ")}
`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify({ comparison: table, thresholds: sweepRows }, null, 2));

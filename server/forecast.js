/* ------------------------------------------------------------------
   Intelligent component #2: turnout forecasting and waitlist release.

   The OCR matcher answers "who is this person at the gate?". This
   module answers the logistics questions before and during an event:
   "how many of the people registered will actually come?" and "how
   many people can we let in off the waitlist without turning anyone
   away at the door?"

   1. Learning from past events.
      Every registration at a past event is a labelled example: they
      either checked in or they didn't. A logistic regression learns
      P(show up | registration) from what SELAE can see at the time of
      registering:
        - how far ahead they registered (and whether it was the same day)
        - their own record at earlier events (smoothed show-up rate,
          first event or not, whether they missed their last one)
        - year level, from the section
        - when the event is (early morning, evening, Friday)
        - whether they got their seat off the waitlist
      Features are built only from events *before* each example, so
      the model is never shown the future. It is fitted by Newton's
      method (iteratively reweighted least squares) with a small L2
      penalty, and checked on the most recent past events held out.

   2. Explaining.
      Each feature's contribution, weight x standardized value, says
      which facts pushed one person's prediction up or down
      ("came to 1 of 4 past events", "registered 9 days ahead").

   3. Updating during the event.
      Not having arrived yet is evidence. From past events SELAE knows
      F(t), the share of eventual attendees who have arrived t minutes
      after the start. By Bayes' rule, for someone not here yet:
         P(comes | not here at t) = p (1 - F(t)) / (p (1 - F(t)) + 1 - p)
      so the forecast tightens as check-in goes on.

   4. Deciding how many seats to release.
      Given how this event goes, arrivals are a sum of independent
      yes/no events with different probabilities: a Poisson-binomial
      distribution, computed exactly. Whole events also swing together
      (rain, exams), and the model is never perfect, so SELAE measures
      how far past events landed from its forecast and averages over
      that uncertainty (see eventSpread below).
      Letting k more people in off the waitlist (in waitlist order, to
      stay fair) raises both the expected headcount and the chance that
      more people come than the venue holds. SELAE recommends the
      largest k whose chance of overflow stays under the organizer's
      limit (5% by default). The organizer decides; nothing is released
      on its own, and the gate still refuses anyone past capacity.

   Everything here is plain math with no Node imports, so the browser
   imports the same functions to update the forecast live.
------------------------------------------------------------------- */

export const DEFAULT_RISK = 0.05;
const MIN_ROWS = 60;      // fewer labelled registrations than this and the model isn't trained
const LAMBDA = 1;         // L2 penalty on the standardized weights
const FALLBACK_RATE = 0.7;

/* ---------- features ---------- */
export const FEATURES = [
  { key: "lead", label: "Days registered ahead (log)" },
  { key: "sameDay", label: "Registered the same day" },
  { key: "pastRate", label: "Own show-up rate at past events" },
  { key: "firstTime", label: "First SELAE event" },
  { key: "missedLast", label: "Missed their last event" },
  { key: "year1", label: "1st year" },
  { key: "year2", label: "2nd year" },
  { key: "year4", label: "4th year" },
  { key: "early", label: "Starts before 9 AM" },
  { key: "evening", label: "Starts at 5 PM or later" },
  { key: "friday", label: "On a Friday" },
  { key: "promoted", label: "Got in off the waitlist" },
];
// Binary features only explain a prediction when they're switched on ("evening event", not "not an evening event")
const ALWAYS_EXPLAIN = new Set(["lead", "pastRate"]);

const yearOf = (section) => { const m = String(section || "").match(/(\d)\s*-\s*\d/); return m ? Number(m[1]) : 0; };
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Raw facts about one registration, plus the feature vector built from them. `hist` is this student's earlier events. */
export function describeRegistration(reg, event, student, hist, { assumePromoted = false } = {}) {
  const start = new Date(event.startsAt);
  const leadDays = Math.max(0, (start - new Date(reg.createdAt)) / 86400000);
  const n = hist.length, came = hist.filter((h) => h.came).length;
  const year = yearOf(student && student.section);
  const hour = start.getHours();
  const facts = { leadDays, n, came, missedLast: n > 0 && !hist[n - 1].came, year, hour, day: start.getDay(),
    promoted: Boolean(reg.promotedAt) || assumePromoted };
  const x = [
    Math.log1p(leadDays), +(leadDays < 1), (came + 1) / (n + 2), +(n === 0), +facts.missedLast,
    +(year === 1), +(year === 2), +(year === 4), +(hour < 9), +(hour >= 17), +(facts.day === 5), +facts.promoted,
  ];
  return { facts, x };
}

function phrase(key, f) {
  switch (key) {
    case "lead": case "sameDay":
      return f.leadDays < 1 ? "registered the same day" : `registered ${Math.round(f.leadDays)} day${Math.round(f.leadDays) === 1 ? "" : "s"} ahead`;
    case "pastRate": case "firstTime":
      return f.n === 0 ? "first SELAE event" : `came to ${f.came} of ${f.n} past event${f.n === 1 ? "" : "s"}`;
    case "missedLast": return "missed their last event";
    case "year1": return "1st year"; case "year2": return "2nd year"; case "year4": return "4th year";
    case "early": return "early-morning event";
    case "evening": return "evening event";
    case "friday": return "Friday event";
    case "promoted": return "got in off the waitlist";
    default: return key;
  }
}

/* ---------- logistic regression, fitted by Newton's method ---------- */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/** Fit P(y=1|x) = sigmoid(b + w·z), z = standardized x. Returns { b, w, mean, sd }. */
export function fitLogistic(X, y, lambda = LAMBDA) {
  const d = X[0].length, n = X.length;
  const mean = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => { mean[j] += v / n; });
  for (const x of X) x.forEach((v, j) => { sd[j] += (v - mean[j]) ** 2 / n; });
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => [1, ...x.map((v, j) => (v - mean[j]) / sd[j])]);
  const base = y.reduce((a, b) => a + b, 0) / n;
  const w = Array(d + 1).fill(0);
  w[0] = Math.log(Math.max(1e-3, base) / Math.max(1e-3, 1 - base));
  for (let it = 0; it < 30; it++) {
    const g = Array(d + 1).fill(0), H = Array.from({ length: d + 1 }, () => Array(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let s = 0;
      for (let j = 0; j <= d; j++) s += w[j] * z[j];
      const p = sigmoid(s), v = p * (1 - p), e = y[i] - p;
      for (let j = 0; j <= d; j++) {
        g[j] += e * z[j];
        const vz = v * z[j];
        for (let k = j; k <= d; k++) H[j][k] += vz * z[k];
      }
    }
    for (let j = 0; j <= d; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    for (let j = 1; j <= d; j++) { g[j] -= lambda * w[j]; H[j][j] += lambda; } // no penalty on the intercept
    const step = solve(H, g);
    let big = 0;
    step.forEach((s, j) => { w[j] += s; big = Math.max(big, Math.abs(s)); });
    if (big < 1e-7) break;
  }
  return { b: w[0], w: w.slice(1), mean, sd };
}

export function predictRaw(fit, x) {
  let s = fit.b;
  x.forEach((v, j) => { s += fit.w[j] * ((v - fit.mean[j]) / fit.sd[j]); });
  return sigmoid(s);
}

/* ---------- metrics ---------- */
export function auc(p, y) {
  const idx = p.map((v, i) => i).sort((a, b) => p[a] - p[b]);
  let rank = 0, sumPos = 0, pos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j < idx.length && p[idx[j]] === p[idx[i]]) j++;
    const avg = (i + j + 1) / 2; // average 1-based rank for ties
    for (let k = i; k < j; k++) if (y[idx[k]]) { sumPos += avg; pos++; }
    rank = j; i = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}
export const brier = (p, y) => p.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / p.length;
export const logLoss = (p, y) => -p.reduce((s, v, i) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, v));
  return s + (y[i] ? Math.log(q) : Math.log(1 - q));
}, 0) / p.length;

/* ---------- training data from past events ---------- */
const startMs = (e) => new Date(e.startsAt).getTime();

/** Labelled examples from every event that has ended, in time order, with features from earlier events only. */
export function buildExamples(data, now = new Date()) {
  const past = data.events.filter((e) => new Date(e.endsAt) < now).sort((a, b) => startMs(a) - startMs(b));
  const regsBy = new Map();
  for (const r of data.registrations) {
    if (!regsBy.has(r.eventId)) regsBy.set(r.eventId, []);
    regsBy.get(r.eventId).push(r);
  }
  const hist = new Map(); // studentId -> [{ start, came }]
  const rows = [];
  const arrivals = [];
  past.forEach((event, eventIndex) => {
    const going = (regsBy.get(event.id) || []).filter((r) => r.status === "going");
    const done = [];
    for (const reg of going) {
      const h = hist.get(reg.studentId) || [];
      const { x } = describeRegistration(reg, event, data.directory[reg.studentId], h);
      rows.push({ x, y: reg.checkin ? 1 : 0, eventIndex, eventId: event.id });
      done.push([reg.studentId, Boolean(reg.checkin)]);
      if (reg.checkin) arrivals.push((new Date(reg.checkin.time) - startMs(event)) / 60000);
    }
    for (const [sid, came] of done) {
      if (!hist.has(sid)) hist.set(sid, []);
      hist.get(sid).push({ start: startMs(event), came });
    }
  });
  return { past, rows, hist, arrivals };
}

/** Quantiles of arrival times (minutes after the start), to estimate F(t). */
function arrivalQuantiles(offsets, n = 60) {
  if (offsets.length < 30) {
    // Not enough history: assume arrivals spread over the first hour, peaking around 10 minutes in
    return Array.from({ length: n + 1 }, (_, i) => -15 + 75 * (i / n) ** 1.6);
  }
  const s = offsets.slice().sort((a, b) => a - b);
  return Array.from({ length: n + 1 }, (_, i) => Math.round(s[Math.min(s.length - 1, Math.floor((i / n) * (s.length - 1)))] * 10) / 10);
}

/**
 * Train the turnout model on every past event. Also reports how it does on the most recent
 * past events when trained only on the ones before them (the honest test).
 */
export function trainTurnout(data, now = new Date()) {
  const { past, rows, hist, arrivals } = buildExamples(data, now);
  const y = rows.map((r) => r.y);
  const base = rows.length ? y.reduce((a, b) => a + b, 0) / rows.length : FALLBACK_RATE;
  const model = {
    ready: false, trainedAt: now.toISOString(), events: past.length, examples: rows.length,
    simulated: past.filter((e) => e.simulated).length, baseRate: base,
    fit: null, hist, arrival: arrivalQuantiles(arrivals), holdout: null, weights: [], spread: 0.3,
  };
  if (rows.length < MIN_ROWS || base === 0 || base === 1) return model;

  // Holdout: the most recent quarter of past events, trained on the rest
  const testFrom = past.length >= 4 ? Math.floor(past.length * 0.75) : past.length;
  const train = rows.filter((r) => r.eventIndex < testFrom), test = rows.filter((r) => r.eventIndex >= testFrom);
  if (test.length >= 20 && train.length >= MIN_ROWS) {
    const f = fitLogistic(train.map((r) => r.x), train.map((r) => r.y));
    const trainBase = train.reduce((a, r) => a + r.y, 0) / train.length;
    const yt = test.map((r) => r.y);
    const pm = test.map((r) => predictRaw(f, r.x));
    const pb = test.map(() => trainBase);
    const pr = test.map((r) => r.x[2]); // the person's own smoothed past rate, on its own
    const byEvent = new Map();
    test.forEach((r, i) => {
      const e = byEvent.get(r.eventId) || { actual: 0, model: 0, base: 0, n: 0 };
      e.actual += r.y; e.model += pm[i]; e.base += trainBase; e.n += 1;
      byEvent.set(r.eventId, e);
    });
    const ev = [...byEvent.values()];
    model.holdout = {
      events: ev.length, examples: test.length,
      auc: auc(pm, yt), aucPastRate: auc(pr, yt),
      brier: brier(pm, yt), brierBase: brier(pb, yt),
      logLoss: logLoss(pm, yt), logLossBase: logLoss(pb, yt),
      headcountError: ev.reduce((s, e) => s + Math.abs(e.model - e.actual), 0) / ev.length,
      headcountErrorBase: ev.reduce((s, e) => s + Math.abs(e.base - e.actual), 0) / ev.length,
      headcountErrorAll: ev.reduce((s, e) => s + Math.abs(e.n - e.actual), 0) / ev.length,
      calibration: calibration(pm, yt),
    };
  }

  model.fit = fitLogistic(rows.map((r) => r.x), y);
  model.ready = true;
  // How far real events land from the forecast: refit on the events before each of the most
  // recent ones and measure the miss. This counts the model's own error, not just event swings.
  const groups = [];
  for (let j = Math.max(1, past.length - 8); j < past.length; j++) {
    const before = rows.filter((r) => r.eventIndex < j), at = rows.filter((r) => r.eventIndex === j);
    if (before.length < MIN_ROWS || at.length < 8) continue;
    const f = fitLogistic(before.map((r) => r.x), before.map((r) => r.y));
    groups.push(at.map((r) => ({ s: logit(predictRaw(f, r.x)), y: r.y })));
  }
  model.spread = eventSpread(groups);
  model.weights = FEATURES.map((f, j) => ({ key: f.key, label: f.label, weight: model.fit.w[j] }));
  return model;
}

function calibration(p, y, bins = 5) {
  const out = Array.from({ length: bins }, (_, i) => ({ from: i / bins, to: (i + 1) / bins, n: 0, predicted: 0, actual: 0 }));
  p.forEach((v, i) => {
    const b = out[Math.min(bins - 1, Math.floor(v * bins))];
    b.n++; b.predicted += v; b.actual += y[i];
  });
  return out.filter((b) => b.n).map((b) => ({ ...b, predicted: b.predicted / b.n, actual: b.actual / b.n }));
}

/** P(show up) for every going and waitlisted registration of one event, with the facts behind each. */
export function predictEvent(model, data, event) {
  const preds = {};
  const start = startMs(event);
  for (const reg of data.registrations) {
    if (reg.eventId !== event.id || (reg.status !== "going" && reg.status !== "waitlist")) continue;
    const h = (model.hist.get(reg.studentId) || []).filter((e) => e.start < start);
    // A waitlisted person would only come if released, so predict them as someone who got in off the waitlist
    const { facts, x } = describeRegistration(reg, event, data.directory[reg.studentId], h, { assumePromoted: reg.status === "waitlist" });
    if (!model.ready) { preds[reg.id] = { p: model.baseRate, why: [] }; continue; }
    const p = predictRaw(model.fit, x);
    const contrib = FEATURES.map((f, j) => ({ key: f.key, c: model.fit.w[j] * ((x[j] - model.fit.mean[j]) / model.fit.sd[j]), on: ALWAYS_EXPLAIN.has(f.key) || x[j] === 1 }))
      .filter((c) => c.on && Math.abs(c.c) > 0.08)
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    const why = [];
    for (const c of contrib) {
      const text = phrase(c.key, facts);
      if (!why.some((w) => w.text === text)) why.push({ text, up: c.c > 0 });
      if (why.length === 3) break;
    }
    preds[reg.id] = { p: Math.round(p * 1000) / 1000, why };
  }
  return preds;
}

/* ---------- live update and the release decision (shared with the browser) ---------- */

/** F(t): share of eventual attendees who have arrived t minutes after the start. */
export function arrivedShare(quantiles, minutes) {
  if (!quantiles || !quantiles.length || minutes < quantiles[0]) return 0;
  if (minutes >= quantiles[quantiles.length - 1]) return 1;
  let lo = 0, hi = quantiles.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (quantiles[mid] <= minutes) lo = mid; else hi = mid; }
  const span = quantiles[hi] - quantiles[lo] || 1;
  return (lo + (minutes - quantiles[lo]) / span) / (quantiles.length - 1);
}

/** Bayes' rule: chance someone still comes, given they haven't arrived t minutes in. */
export function stillComing(p, share) {
  const late = p * (1 - share);
  return late + (1 - p) > 0 ? late / (late + (1 - p)) : 0;
}

/** Exact distribution of how many of these independent people turn up. */
export function poissonBinomial(probs) {
  let pmf = [1];
  for (const p of probs) pmf = addPerson(pmf, p);
  return pmf;
}
function addPerson(pmf, p) {
  const next = Array(pmf.length + 1).fill(0);
  for (let k = 0; k < pmf.length; k++) { next[k] += pmf[k] * (1 - p); next[k + 1] += pmf[k] * p; }
  return next;
}
function quantile(pmf, q) {
  let s = 0;
  for (let k = 0; k < pmf.length; k++) { s += pmf[k]; if (s >= q) return k; }
  return pmf.length - 1;
}

/* Event-level swings. Attendees don't decide independently: rain, an exam the next day or a dull
   topic moves everyone at once. Each event gets a shift d added to every attendee's log-odds,
   with d ~ N(0, spread^2) learned from past events. The forecast averages over d with 7-point
   Gauss-Hermite quadrature, and during check-in, who has and hasn't arrived updates the belief
   about d by Bayes' rule. Ignoring this made a "1% risk" release overflow far more often. */
const GH = [[0, 0.4571428571428571], [1.1544053947399682, 0.2401231786050126], [-1.1544053947399682, 0.2401231786050126],
  [2.366759410734541, 0.03075712396758654], [-2.366759410734541, 0.03075712396758654],
  [3.750439717725742, 0.0005482688559722184], [-3.750439717725742, 0.0005482688559722184]];
const logit = (p) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };

/** How far whole events land from the forecast, as a standard deviation on the log-odds scale.
    For each event, the shift d that would have made the forecast match it; the spread is the root
    mean square of those shifts, less the part explained by chance in a finite crowd. */
export function eventSpread(groups) {
  const shifts = [], noise = [];
  for (const rows of groups) {
    if (rows.length < 8) continue;
    let d = 0, info = 0;
    for (let it = 0; it < 30; it++) {
      let g = 0; info = 0;
      for (const { s, y } of rows) { const p = sigmoid(s + d); g += y - p; info += p * (1 - p); }
      const step = g / Math.max(info, 1e-6);
      d = Math.max(-4, Math.min(4, d + step));
      if (Math.abs(step) < 1e-8) break;
    }
    shifts.push(d); noise.push(1 / Math.max(info, 1e-6));
  }
  if (shifts.length < 3) return 0.3;
  const meanSquare = shifts.reduce((a, b) => a + b * b, 0) / shifts.length;
  return Math.sqrt(Math.max(0.01, meanSquare - noise.reduce((a, b) => a + b, 0) / noise.length));
}

/**
 * The forecast for one event at time `now`.
 *   regs:   the event's registrations (status, checkin, id)
 *   preds:  { [regId]: { p } } from predictEvent
 *   spread: how much whole events swing (eventSpread); 0 treats attendees as independent
 * Returns the expected final headcount with a 90% range, and for every
 * number of waitlist releases k, the chance of overflowing the venue,
 * the expected empty seats and the expected people turned away.
 */
export function forecastNow({ capacity, startsAt, endsAt, regs, preds, arrival, spread = 0, now = new Date(), risk = DEFAULT_RISK }) {
  const minutes = (new Date(now) - new Date(startsAt)) / 60000;
  const ended = new Date(now) > new Date(endsAt);
  const share = ended ? 1 : arrivedShare(arrival, minutes);
  const base = (r) => logit(preds[r.id] ? preds[r.id].p : FALLBACK_RATE);
  const insideRegs = regs.filter((r) => r.checkin);
  const inside = insideRegs.length;
  const pending = regs.filter((r) => r.status === "going" && !r.checkin);
  const waitlist = regs.filter((r) => r.status === "waitlist").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Belief about this event's shift, updated by who has arrived so far
  const nodes = (spread > 0 ? GH : [[0, 1]]).map(([x, w]) => {
    const d = spread * x;
    let lw = Math.log(w);
    if (share > 0) {
      for (const r of insideRegs) lw += Math.log(sigmoid(base(r) + d));
      for (const r of pending) lw += Math.log(1 - sigmoid(base(r) + d) * share);
    }
    return { d, lw };
  });
  const top = Math.max(...nodes.map((n) => n.lw));
  const total = nodes.reduce((a, n) => a + Math.exp(n.lw - top), 0);
  nodes.forEach((n) => { n.w = Math.exp(n.lw - top) / total; });

  const liveAt = (r, d) => (ended ? 0 : stillComing(sigmoid(base(r) + d), share));
  const livePct = {};
  for (const r of [...pending, ...waitlist]) livePct[r.id] = nodes.reduce((a, n) => a + n.w * liveAt(r, n.d), 0);

  const pmfs = nodes.map((n) => poissonBinomial(pending.map((r) => liveAt(r, n.d))));
  const mix = (list) => list[0].map((_, k) => list.reduce((a, pmf, i) => a + nodes[i].w * pmf[k], 0));
  const mixed = mix(pmfs);
  const expectedOf = (dist) => dist.reduce((s, v, k) => s + v * k, 0);
  const headcount = { expected: inside + expectedOf(mixed), lo: inside + quantile(mixed, 0.05), hi: inside + quantile(mixed, 0.95), inside };

  const steps = [];
  const free = capacity - inside;
  for (let k = 0; k <= waitlist.length; k++) {
    let over = 0, empty = 0, away = 0;
    pmfs.forEach((pmf, i) => pmf.forEach((v, n) => {
      const pv = v * nodes[i].w;
      if (n > free) { over += pv; away += pv * (n - free); } else empty += pv * (free - n);
    }));
    steps.push({ k, overflow: over, empty, turnedAway: away });
    if (k < waitlist.length) nodes.forEach((n, i) => { pmfs[i] = addPerson(pmfs[i], liveAt(waitlist[k], n.d)); });
  }
  let release = 0;
  for (const st of steps) if (st.overflow <= risk) release = st.k; else break;
  if (ended) release = 0;
  const shift = nodes.reduce((a, n) => a + n.w * n.d, 0);
  return { minutes, ended, share, headcount, steps, release, risk, spread, shift, live: livePct, waitlistOrder: waitlist.map((r) => r.id) };
}

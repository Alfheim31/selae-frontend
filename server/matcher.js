/* ------------------------------------------------------------------
   Intelligent component: probabilistic identity matching for OCR reads.

   When a QR ticket or ID barcode can't be read, the gate camera reads
   the printed student number with OCR. OCR under glare makes mistakes,
   and they aren't random: 8 and 3, 1 and 7, 5 and 6 get swapped far more
   often than 1 and 0. This module decides who the attendee most likely
   is, and how sure it is, instead of guessing.

   1. Knowledge: a noisy-channel model of OCR.
      P(read digit | true digit) comes from a confusion matrix: prior
      pseudo-counts (what we expect from OCR in general) plus counts
      learned from operator corrections at this venue. There is also a
      chance a digit is dropped (deletion) or an extra one appears
      (insertion).

   2. Evidence: Tesseract's per-character confidence c. A digit read
      with c = 0.99 is almost certainly right; one read with c = 0.40 is
      probably wrong, and the confusion matrix says what it probably was:
         L(r | t) = c                      if r == t
                  = (1 - c) * Q(r | t)     otherwise
      where Q(r | t) is how misreads of t are spread over other digits
      (the confusion matrix row without its diagonal, renormalized).

   3. Reasoning: Bayes' rule over everyone it could be.
         P(student | read) ∝ P(read | student) * P(student)
      P(read | student) sums over every way the read could align with
      that student's number (forward algorithm). The prior P(student)
      uses what the event knows: a registered guest who hasn't arrived
      yet is far likelier to be at the gate than one already inside or
      someone not registered at all. An "unknown person" hypothesis
      soaks up probability when the read looks like nobody on file.

   4. Acting: a three-band decision policy.
         top posterior >= autoAt     -> identify automatically
         top posterior >= confirmAt  -> ask the operator to pick
         otherwise                   -> send to manual entry
      Who gets *admitted* is still decided by the check-in rules in
      api.js (registered, not a duplicate, under capacity). The matcher
      only answers "who is this?".

   5. Learning: when an operator confirms a candidate (or types the right
      student after "none of these"), the read is aligned with the true
      number and each digit pair is counted into the confusion matrix.
      The model adapts to this venue's lighting and this batch of cards.
------------------------------------------------------------------- */

export const DIGITS = 10;
const DEL = 10; // column index for "true digit was not read at all"

// Digit pairs OCR commonly confuses, especially under glare or blur.
// These set the starting beliefs; corrections at the venue adjust them.
export const CONFUSABLE = [
  [0, 8], [0, 6], [0, 9], [1, 7], [1, 4], [2, 7], [3, 8], [3, 5],
  [4, 9], [5, 6], [5, 8], [6, 8], [8, 9], [2, 3],
];

export const PRIOR = {
  correct: 60,      // pseudo-count on the diagonal
  confusable: 3,    // pseudo-count for each common confusion (both directions)
  other: 0.3,       // pseudo-count for any other substitution
  deletion: 0.6,    // pseudo-count for a dropped digit
  insertions: 1,    // pseudo-count of extra digits ...
  ops: 100,         // ... per this many characters read
};

// Tuned with scripts/eval-matcher.js (npm run eval). Raising autoAt means fewer
// wrong automatic identifications but more reads for the operator to confirm;
// 0.95 decides about 5 in 6 reads alone in the synthetic test.
export const DEFAULT_THRESHOLDS = { autoAt: 0.95, confirmAt: 0.4 };

// How likely each kind of person is to be the one standing at the gate
export const PRIOR_WEIGHT = {
  expected: 1,      // registered as going, not checked in yet
  inside: 0.05,     // registered, already checked in (a repeat scan)
  waitlist: 0.1,    // on the waitlist
  stranger: 0.01,   // in the student directory but not registered for this event
};
const UNKNOWN_SHARE = 0.05; // share of prior mass for someone not on file at all

// Tesseract tends to be overconfident; never let one character's
// confidence rule out an alternative completely.
const CONF_FLOOR = 0.05, CONF_CEIL = 0.97;

/* ---------- model state ---------- */
export function emptyModel() {
  return {
    learned: Array.from({ length: DIGITS }, () => Array(DIGITS + 1).fill(0)),
    insertions: 0,
    ops: 0,
    corrections: 0,
    thresholds: { ...DEFAULT_THRESHOLDS },
    updatedAt: null,
  };
}

/** Old data files have no matcher section yet; add one in place. */
export function ensureModel(data) {
  if (!data.matcher) data.matcher = emptyModel();
  if (!data.ocrScans) data.ocrScans = [];
  return data.matcher;
}

function priorCount(t, r) {
  if (r === DEL) return PRIOR.deletion;
  if (t === r) return PRIOR.correct;
  return CONFUSABLE.some(([a, b]) => (a === t && b === r) || (a === r && b === t)) ? PRIOR.confusable : PRIOR.other;
}

/** P(read | true) as a 10 x 11 matrix (last column: deletion), plus insertion rate. */
export function channel(model) {
  const P = [];
  for (let t = 0; t < DIGITS; t++) {
    const row = [];
    let sum = 0;
    for (let r = 0; r <= DIGITS; r++) { row[r] = priorCount(t, r) + (model ? model.learned[t][r] : 0); sum += row[r]; }
    P.push(row.map((v) => v / sum));
  }
  const pIns = (PRIOR.insertions + (model ? model.insertions : 0)) / (PRIOR.ops + (model ? model.ops : 0));
  return { P, pIns };
}

/* ---------- helpers ---------- */
export const digitsOf = (s) => String(s || "").replace(/\D/g, "");

/** Format 9 digits as YYYY-NNNNN when possible, for display. */
export const pretty = (d) => (d.length === 9 ? `${d.slice(0, 4)}-${d.slice(4)}` : d);

function logSumExp(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

const clampConf = (c) => (typeof c === "number" && Number.isFinite(c) ? Math.min(CONF_CEIL, Math.max(CONF_FLOOR, c)) : null);

/** Evidence-weighted emission: how well read digit r (with OCR confidence c) supports true digit t. */
function emission(ch, t, r, c) {
  if (c == null) return ch.P[t][r];
  if (r === t) return c;
  const wrong = 1 - ch.P[t][t] - ch.P[t][DEL]; // chance of reading t as some other digit
  return (1 - c) * (ch.P[t][r] / wrong);
}

/* ---------- likelihood: forward algorithm over alignments ----------
   States (i, j): i digits of the true number and j digits of the read
   have been accounted for. From each state the channel either
     - inserts a spurious read digit           (i, j) -> (i, j+1)
     - drops the next true digit               (i, j) -> (i+1, j)
     - reads the next true digit as some digit (i, j) -> (i+1, j+1)
   Summing every path gives P(read | true number). With `best` set, it
   keeps only the most likely path (Viterbi) and returns it, which is
   what learning uses to decide which digit was misread as which. */
function align(truth, read, conf, ch, best = false) {
  const n = truth.length, m = read.length;
  const comb = best ? Math.max : logSumExp;
  const lIns = Math.log(ch.pIns / DIGITS);
  const lGo = Math.log(1 - ch.pIns);
  const F = Array.from({ length: n + 1 }, () => Array(m + 1).fill(-Infinity));
  const back = best ? Array.from({ length: n + 1 }, () => Array(m + 1).fill(null)) : null;
  F[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = F[i][j];
      if (here === -Infinity) continue;
      const step = (ni, nj, lp, op) => {
        const v = here + lp;
        const prev = F[ni][nj];
        const next = comb(prev, v);
        if (best && v > prev) back[ni][nj] = { i, j, op };
        F[ni][nj] = next;
      };
      if (j < m) step(i, j + 1, lIns, { kind: "ins", r: +read[j] });
      if (i < n) {
        const t = +truth[i];
        step(i + 1, j, lGo + Math.log(ch.P[t][DEL]), { kind: "del", t });
        if (j < m) {
          const r = +read[j];
          const e = emission(ch, t, r, conf ? clampConf(conf[j]) : null);
          step(i + 1, j + 1, lGo + Math.log(Math.max(e, 1e-12)), { kind: "sub", t, r });
        }
      }
    }
  }
  const logL = F[n][m] + lGo; // stop: no more insertions
  if (!best) return logL;
  const ops = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[i][j];
    if (!b) break;
    ops.push(b.op);
    i = b.i; j = b.j;
  }
  return { logL, ops: ops.reverse() };
}

/* The same forward sum, fast: everything that depends only on the read is
   computed once per read (logEmissions), so scoring each person on file is
   a small table walk. rank() uses this for every student in the directory. */
function logEmissions(read, conf, ch) {
  return Array.from(read, (r, j) => {
    const c = conf ? clampConf(conf[j]) : null;
    return Float64Array.from({ length: DIGITS }, (_, t) => Math.log(Math.max(emission(ch, t, +r, c), 1e-12)));
  });
}
function forwardFast(truth, E, ch, lDel) {
  const n = truth.length, m = E.length, W = m + 1;
  const lIns = Math.log(ch.pIns / DIGITS), lGo = Math.log(1 - ch.pIns);
  const F = new Float64Array((n + 1) * W).fill(-Infinity);
  F[0] = 0;
  for (let i = 0; i <= n; i++) {
    const t = i < n ? truth.charCodeAt(i) - 48 : -1;
    for (let j = 0; j <= m; j++) {
      const here = F[i * W + j];
      if (here === -Infinity) continue;
      if (j < m) F[i * W + j + 1] = logSumExp(F[i * W + j + 1], here + lIns);
      if (t >= 0) {
        F[(i + 1) * W + j] = logSumExp(F[(i + 1) * W + j], here + lGo + lDel[t]);
        if (j < m) F[(i + 1) * W + j + 1] = logSumExp(F[(i + 1) * W + j + 1], here + lGo + E[j][t]);
      }
    }
  }
  return F[n * W + m] + lGo;
}

export const logLikelihood = (truth, read, conf, ch) => align(digitsOf(truth), digitsOf(read), conf, ch, false);
export const bestAlignment = (truth, read, ch) => align(digitsOf(truth), digitsOf(read), null, ch, true);

/** Likelihood of the read if the person isn't anyone on file.
    Their number is unseen, but it still looks like a student number
    (the year prefix, mostly), so each position's digit is drawn from
    how digits are spread at that position across everyone on file. */
function unknownLogL(read, conf, ch, people) {
  const m = read.length;
  const ids = people.map((x) => digitsOf(x.id)).filter((d) => d.length === m);
  let logL = Math.log(1 - ch.pIns) * (m + 1);
  for (let j = 0; j < m; j++) {
    const q = Array(DIGITS).fill(1); // add-one smoothing
    for (const d of ids) q[+d[j]] += 1;
    const total = DIGITS + ids.length;
    const c = conf ? clampConf(conf[j]) : null;
    let s = 0;
    for (let t = 0; t < DIGITS; t++) s += (q[t] / total) * emission(ch, t, +read[j], c) * (1 - ch.P[t][DEL]);
    logL += Math.log(Math.max(s, 1e-12));
  }
  return logL;
}

/* ---------- reasoning: posterior over everyone it could be ---------- */
/**
 * people: [{ id: "2023-41587", weight: PRIOR_WEIGHT.x, ...anything }]
 * read:   OCR text (non-digits are ignored)
 * conf:   per-digit OCR confidence 0..1, same length as the digits of read (optional)
 *
 * Returns { candidates: [{ ...person, p, logL }], pUnknown, decision, top }
 */
export function rank(people, read, conf, model, { limit = 3 } = {}) {
  const ch = channel(model);
  const r = digitsOf(read);
  const confDigits = conf && conf.length === r.length ? conf : null;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(model && model.thresholds) };

  const totalWeight = people.reduce((s, x) => s + x.weight, 0);
  const unknownWeight = UNKNOWN_SHARE * Math.max(totalWeight, 1) / (1 - UNKNOWN_SHARE);

  const E = logEmissions(r, confDigits, ch);
  const lDel = ch.P.map((row) => Math.log(row[DEL]));
  const scored = people.map((x) => ({ ...x, logL: forwardFast(digitsOf(x.id), E, ch, lDel) }));
  const uLogL = unknownLogL(r, confDigits, ch, people);

  // Normalize in log space so tiny likelihoods don't underflow
  const logPost = scored.map((x) => x.logL + Math.log(x.weight));
  const uLogPost = uLogL + Math.log(unknownWeight);
  let Z = uLogPost;
  for (const v of logPost) Z = logSumExp(Z, v);
  scored.forEach((x, i) => { x.p = Math.exp(logPost[i] - Z); });
  const pUnknown = Math.exp(uLogPost - Z);

  scored.sort((a, b) => b.p - a.p);
  const candidates = scored.slice(0, limit);
  const top = candidates[0] || null;

  let decision;
  if (!r.length || !top || pUnknown >= top.p) decision = "reject";
  else if (top.p >= thresholds.autoAt) decision = "auto";
  else if (top.p >= thresholds.confirmAt) decision = "confirm";
  else decision = "reject";

  return { read: r, candidates, pUnknown, decision, top, thresholds };
}

/** Prior weight for a student, from what this event knows about them. */
export function priorWeight(reg) {
  if (!reg || reg.status === "cancelled") return PRIOR_WEIGHT.stranger;
  if (reg.status === "waitlist") return PRIOR_WEIGHT.waitlist;
  return reg.checkin ? PRIOR_WEIGHT.inside : PRIOR_WEIGHT.expected;
}

/* ---------- learning from operator corrections ---------- */
const MAX_EDITS_TO_LEARN = 3;

/**
 * The operator said this read belonged to trueId. Count every aligned
 * digit pair (including the correct ones) into the confusion matrix.
 * Skips reads that look nothing like the chosen number, so a slip (the
 * operator typing the next person in line) doesn't teach the model nonsense.
 * Returns the list of misreads learned, or null if skipped.
 */
export function learn(model, read, trueId) {
  const r = digitsOf(read), t = digitsOf(trueId);
  if (!r.length || !t.length) return null;
  const { ops } = bestAlignment(t, r, channel(model));
  const edits = ops.filter((o) => o.kind !== "sub" || o.t !== o.r);
  if (edits.length > MAX_EDITS_TO_LEARN) return null;
  for (const o of ops) {
    if (o.kind === "sub") model.learned[o.t][o.r] += 1;
    else if (o.kind === "del") model.learned[o.t][DEL] += 1;
    else model.insertions += 1;
  }
  model.ops += r.length;
  model.corrections += 1;
  model.updatedAt = new Date().toISOString();
  return edits.map((o) => (o.kind === "sub" ? `${o.t}→${o.r}` : o.kind === "del" ? `${o.t}→∅` : `∅→${o.r}`));
}

/** Most-learned confusions, for the analytics panel. */
export function topConfusions(model, n = 6) {
  const out = [];
  for (let t = 0; t < DIGITS; t++)
    for (let r = 0; r <= DIGITS; r++)
      if (r !== t && model.learned[t][r] > 0) out.push({ true: t, read: r === DEL ? null : r, count: model.learned[t][r] });
  return out.sort((a, b) => b.count - a.count).slice(0, n);
}

/** Probability a single digit is read correctly, averaged over digits. */
export function digitAccuracy(model) {
  const { P } = channel(model);
  return P.reduce((s, row, t) => s + row[t], 0) / DIGITS;
}

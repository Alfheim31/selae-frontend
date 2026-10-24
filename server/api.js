import os from "node:os";
import { newCode, newId, hashKey } from "./seed.js";
import { ensureModel, rank, priorWeight, learn, pretty, digitsOf, topConfusions, digitAccuracy, emptyModel } from "./matcher.js";
import { trainTurnout, predictEvent, forecastNow, DEFAULT_RISK } from "./forecast.js";

/* ------------------------------------------------------------------
   Logical layer: every rule about events, registration and check-in.

   Who can do what:
   - Anyone on the network can browse public events, register, and
     view or cancel their own ticket (the ticket code is the secret).
   - Managing an event (dashboard, scanner, edits) needs that event's
     host key, which the creator's browser keeps. The laptop running
     the server (requests from localhost) can manage every event.
------------------------------------------------------------------- */

const COLORS = ["gold", "blue", "green", "rose", "violet", "teal"];
const SUFFIXES = ["", "Jr.", "Sr.", "II", "III", "IV"];
const STUDENT_ID = /^(\d{4})\s*-?\s*(\d{5})$/;
const TICKET = /^SELAE1:([a-z0-9-]+):([A-Z2-9]{10})$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

/* ---------- name standardization (Surname, Given M.) ---------- */
// Typed in all-lowercase or all-caps gets title-cased; anything with
// deliberate mixed case (McDonald, DelaCruz) is kept as typed.
function tidyName(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
function tidyInitial(raw) {
  const m = String(raw || "").trim().match(/\p{L}/u);
  return m ? m[0].toUpperCase() : "";
}

/* ---------- views ---------- */
function counts(data, eventId) {
  let going = 0, waitlist = 0, checkedIn = 0;
  for (const r of data.registrations) {
    if (r.eventId !== eventId) continue;
    if (r.status === "going") going++;
    else if (r.status === "waitlist") waitlist++;
    if (r.checkin) checkedIn++;
  }
  return { going, waitlist, checkedIn };
}
function canManage(req, event) {
  if (isLocal(req)) return true;
  const key = req.headers["x-selae-host-key"];
  if (!key) return false;
  const keys = String(key).split(",").map((k) => k.trim());
  return keys.some((k) => hashKey(k) === event.hostKeyHash);
}
function publicEvent(data, req, e) {
  const c = counts(data, e.id);
  const { hostKeyHash, ...rest } = e;
  const isPast = Date.now() > new Date(e.endsAt).getTime();
  return { ...rest, counts: c, spotsLeft: Math.max(0, e.capacity - c.going), isPast,
    registrationOpen: e.registrationOpen && !isPast, canManage: canManage(req, e) };
}
function ticketView(data, req, reg) {
  const event = data.events.find((e) => e.id === reg.eventId);
  const student = data.directory[reg.studentId];
  return {
    code: reg.code, status: reg.status, createdAt: reg.createdAt, checkin: reg.checkin,
    qr: `SELAE1:${reg.eventId}:${reg.code}`,
    student, event: event ? publicEvent(data, req, event) : null,
  };
}

/* ---------- validation ---------- */
function str(v, field, { max, required = true } = {}) {
  const s = String(v ?? "").trim();
  if (required && !s) fail(400, `${field} is required.`);
  if (max && s.length > max) fail(400, `${field} must be ${max} characters or fewer.`);
  return s;
}
function eventFields(body, existing = {}) {
  const has = (k) => body[k] !== undefined;
  const out = {};
  if (has("title") || !existing.title) out.title = str(body.title, "Title", { max: 120 });
  if (has("venue") || !existing.venue) out.venue = str(body.venue, "Venue", { max: 120 });
  if (has("description")) out.description = str(body.description, "Description", { max: 2000, required: false });
  if (has("hostName")) out.hostName = str(body.hostName, "Host name", { max: 80, required: false });
  if (has("capacity") || !existing.capacity) {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) fail(400, "Capacity must be a whole number from 1 to 100,000.");
    out.capacity = n;
  }
  for (const k of ["startsAt", "endsAt"]) {
    if (has(k) || !existing[k]) {
      const d = new Date(body[k]);
      if (Number.isNaN(d.getTime())) fail(400, `${k === "startsAt" ? "Start" : "End"} time is missing or invalid.`);
      out[k] = d.toISOString();
    }
  }
  const starts = new Date(out.startsAt || existing.startsAt), ends = new Date(out.endsAt || existing.endsAt);
  if (ends <= starts) fail(400, "The event has to end after it starts.");
  if (has("color")) { if (!COLORS.includes(body.color)) fail(400, "Unknown cover color."); out.color = body.color; }
  if (has("visibility")) { if (!["public", "unlisted"].includes(body.visibility)) fail(400, "Unknown visibility."); out.visibility = body.visibility; }
  if (has("registrationOpen")) out.registrationOpen = Boolean(body.registrationOpen);
  return out;
}

/* ---------- check-in rules ---------- */
function checkIn(data, event, body) {
  const now = new Date().toISOString();
  const method = ["qr", "barcode", "ocr", "confirmed", "manual"].includes(body.method) ? body.method : "manual";
  const confidence = typeof body.confidence === "number" ? Math.max(0, Math.min(1, body.confidence)) : null;
  const log = (outcome, studentId, extra = {}) =>
    data.logs.push({ uid: newId(), eventId: event.id, time: now, studentId: studentId || null, outcome, method, ...extra });

  let reg = null;
  let studentId = null;
  if (body.ticket) {
    const m = String(body.ticket).trim().match(TICKET);
    const found = m && data.registrations.find((r) => r.code === m[2]);
    if (!found) { log("unresolved", null); return { outcome: "unresolved", time: now }; }
    if (found.eventId !== event.id) {
      const other = data.events.find((e) => e.id === found.eventId);
      log("wrongevent", found.studentId);
      return { outcome: "wrongevent", time: now, student: data.directory[found.studentId], otherEvent: other ? { id: other.id, title: other.title, startsAt: other.startsAt } : null };
    }
    reg = found;
    studentId = found.studentId;
  } else {
    const m = String(body.studentId || "").match(STUDENT_ID);
    if (!m) fail(400, "Send a ticket or a student number.");
    studentId = `${m[1]}-${m[2]}`;
    reg = data.registrations.find((r) => r.eventId === event.id && r.studentId === studentId && r.status !== "cancelled") || null;
  }

  resolveScan(data, event, body, method, studentId);

  const student = data.directory[studentId] || { id: studentId, last: "", first: "", middle: "", suffix: "", section: "" };
  if (!reg || reg.status === "cancelled") { log("notreg", studentId); return { outcome: "notreg", time: now, student }; }
  if (reg.status === "waitlist") { log("waitlist", studentId); return { outcome: "waitlist", time: now, student }; }
  if (reg.checkin) { log("dup", studentId); return { outcome: "dup", time: now, student, previous: reg.checkin }; }
  if (body.forceFull || counts(data, event.id).checkedIn >= event.capacity) { log("full", studentId); return { outcome: "full", time: now, student }; }
  reg.checkin = { time: now, method, confidence };
  log("approved", studentId, { confidence });
  return { outcome: "approved", time: now, student, checkin: reg.checkin };
}

/* ---------- OCR matching (see matcher.js) ---------- */
const MAX_SCANS = 3000;

/** Everyone the OCR read could belong to, each with a prior weight from this event. */
function peopleFor(data, event) {
  const regs = new Map();
  for (const r of data.registrations) if (r.eventId === event.id && r.status !== "cancelled") regs.set(r.studentId, r);
  return Object.values(data.directory).map((s) => ({ id: s.id, weight: priorWeight(regs.get(s.id)), reg: regs.get(s.id) || null }));
}

function statusOf(reg) {
  if (!reg) return "notreg";
  if (reg.status === "waitlist") return "waitlist";
  return reg.checkin ? "inside" : "going";
}

function matchRead(data, event, body) {
  const read = digitsOf(body.read);
  if (!read.length || read.length > 20) fail(400, "Send the digits OCR read.");
  const conf = Array.isArray(body.conf) && body.conf.length === read.length && body.conf.every((c) => typeof c === "number")
    ? body.conf.map((c) => Math.max(0, Math.min(1, c))) : null;
  const model = ensureModel(data);
  const out = rank(peopleFor(data, event), read, conf, model);
  const scan = {
    id: newId(), eventId: event.id, time: new Date().toISOString(), read, conf, source: body.source === "demo" ? "demo" : "camera",
    decision: out.decision, pUnknown: out.pUnknown,
    candidates: out.candidates.map((c) => ({ id: c.id, p: c.p })),
    resolution: null, truth: null, rank: null, learned: null,
  };
  data.ocrScans.push(scan);
  if (data.ocrScans.length > MAX_SCANS) data.ocrScans.splice(0, data.ocrScans.length - MAX_SCANS);
  return {
    scanId: scan.id, read: pretty(read), decision: out.decision, pUnknown: out.pUnknown, thresholds: out.thresholds,
    candidates: out.candidates.map((c) => ({ p: c.p, status: statusOf(c.reg),
      student: data.directory[c.id] || { id: c.id, last: "", first: "", middle: "", suffix: "", section: "" } })),
  };
}

/** A check-in that came from an OCR scan: record who it turned out to be, and learn when a person said so. */
function resolveScan(data, event, body, method, studentId) {
  if (!body.scanId) return;
  const scan = (data.ocrScans || []).find((s) => s.id === body.scanId && s.eventId === event.id);
  // "none" means the operator rejected every candidate; typing the right student afterwards still labels it
  if (!scan || (scan.resolution && scan.resolution !== "none")) return;
  scan.resolution = method === "ocr" ? "auto" : method === "confirmed" ? "confirmed" : "manual";
  scan.truth = studentId;
  scan.rank = scan.candidates.findIndex((c) => c.id === studentId);
  // Only a human's answer is a label worth learning from; the matcher's own guesses are not
  if (method === "confirmed" || method === "manual") scan.learned = learn(ensureModel(data), scan.read, studentId);
}

function matcherSummary(data, eventId) {
  const model = ensureModel(data);
  const scans = data.ocrScans.filter((s) => s.eventId === eventId);
  const by = (k, v) => scans.filter((s) => s[k] === v).length;
  const labelled = scans.filter((s) => s.resolution === "confirmed" || s.resolution === "manual");
  return {
    corrections: model.corrections,
    updatedAt: model.updatedAt,
    thresholds: model.thresholds,
    digitAccuracy: { prior: digitAccuracy(null), now: digitAccuracy(model) },
    topConfusions: topConfusions(model),
    scans: {
      total: scans.length,
      auto: by("decision", "auto"), confirm: by("decision", "confirm"), reject: by("decision", "reject"),
      // Of the reads a person resolved, where was the right student in SELAE's ranking?
      labelled: labelled.length,
      top1: labelled.filter((s) => s.rank === 0).length,
      top3: labelled.filter((s) => s.rank >= 0).length,
      none: by("resolution", "none"),
      demo: by("source", "demo"),
    },
    recent: scans.slice(-8).reverse().map((s) => ({ time: s.time, read: pretty(s.read), decision: s.decision, top: s.candidates[0] || null,
      resolution: s.resolution, truth: s.truth, learned: s.learned })),
  };
}

/* ---------- routing ---------- */
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) fail(413, "Request too large.");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(400, "Invalid JSON."); }
}

function lanUrls(req) {
  const port = (req.headers.host || "").split(":")[1] || "";
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}${port ? ":" + port : ""}`);
  }
  return urls;
}

/* ---------- turnout forecast (see forecast.js) ---------- */
// Retrained only when the set of finished events or their outcomes change, not on every check-in
function historyKey(data, now) {
  const past = new Set(data.events.filter((e) => new Date(e.endsAt) < now).map((e) => e.id));
  let regs = 0, came = 0;
  for (const r of data.registrations) if (past.has(r.eventId)) { regs += r.status === "going"; came += Boolean(r.checkin); }
  return `${[...past].sort().join(",")}|${regs}|${came}`;
}

export function createApi(store) {
  let turnout = null, turnoutKey = "";
  const turnoutModel = () => {
    const now = new Date();
    const key = historyKey(store.data, now);
    if (!turnout || key !== turnoutKey) { turnout = trainTurnout(store.data, now); turnoutKey = key; }
    return turnout;
  };
  const forecastFor = (event, risk = DEFAULT_RISK) => {
    const model = turnoutModel();
    const regs = store.data.registrations.filter((r) => r.eventId === event.id);
    return forecastNow({ capacity: event.capacity, startsAt: event.startsAt, endsAt: event.endsAt, regs,
      preds: predictEvent(model, store.data, event), arrival: model.arrival, spread: model.spread, now: new Date(), risk });
  };
  const forecastSummary = (event) => {
    const m = turnoutModel();
    return {
      model: { ready: m.ready, trainedAt: m.trainedAt, events: m.events, examples: m.examples, simulated: m.simulated,
        baseRate: m.baseRate, holdout: m.holdout, weights: m.weights, spread: m.spread },
      arrival: m.arrival,
      spread: m.spread,
      preds: predictEvent(m, store.data, event),
      defaultRisk: DEFAULT_RISK,
    };
  };
  const findEvent = (id) => store.data.events.find((e) => e.id === id) || fail(404, "Event not found.");
  const requireManage = (req, event) => { if (!canManage(req, event)) fail(403, "Only this event's hosts can do that."); };

  const routes = [
    ["GET", /^\/api\/info$/, (req) => ({ isLocal: isLocal(req), lanUrls: lanUrls(req) })],

    ["GET", /^\/api\/events$/, (req) => {
      const d = store.data;
      return d.events
        .filter((e) => e.visibility === "public" || canManage(req, e))
        .map((e) => publicEvent(d, req, e))
        .sort((a, b) => (a.isPast - b.isPast) || (a.isPast ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
    }],

    ["POST", /^\/api\/events$/, async (req) => {
      const body = await readBody(req);
      const fields = eventFields(body);
      const hostKey = newCode(16);
      const event = store.mutate((d) => {
        const e = { id: newId(), description: "", hostName: "", color: "gold", visibility: "public", registrationOpen: true,
          ...fields, hostKeyHash: hashKey(hostKey), createdAt: new Date().toISOString() };
        d.events.push(e);
        return e;
      });
      return { event: { ...publicEvent(store.data, req, event), canManage: true }, hostKey };
    }],

    ["GET", /^\/api\/events\/([\w-]+)$/, (req, [id]) => publicEvent(store.data, req, findEvent(id))],

    ["PATCH", /^\/api\/events\/([\w-]+)$/, async (req, [id]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const fields = eventFields(await readBody(req), event);
      store.mutate(() => Object.assign(event, fields));
      return publicEvent(store.data, req, event);
    }],

    ["POST", /^\/api\/events\/([\w-]+)\/register$/, async (req, [id]) => {
      const event = findEvent(id);
      const pub = publicEvent(store.data, req, event);
      if (!pub.registrationOpen) fail(409, pub.isPast ? "This event has already ended." : "Registration is closed for this event.");
      const b = await readBody(req);
      const m = String(b.studentId || "").trim().match(STUDENT_ID);
      if (!m) fail(400, "Student number should look like 2024-12345.");
      const studentId = `${m[1]}-${m[2]}`;
      const first = tidyName(str(b.first, "Given name", { max: 60 }));
      const last = tidyName(str(b.last, "Surname", { max: 60 }));
      const middle = tidyInitial(b.middle);
      const suffix = SUFFIXES.includes(b.suffix) ? b.suffix : "";
      const section = str(b.section, "Section", { max: 30 }).toUpperCase().replace(/\s+/g, " ");
      const email = str(b.email, "Email", { max: 120, required: false });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "That email address doesn't look right.");

      return store.mutate((d) => {
        d.directory[studentId] = { id: studentId, last, first, middle, suffix, section };
        const existing = d.registrations.find((r) => r.eventId === id && r.studentId === studentId && r.status !== "cancelled");
        if (existing) return { existing: true, ticket: ticketView(d, req, existing) };
        const going = counts(d, id).going;
        const reg = { id: newId(), eventId: id, code: newCode(), studentId, email, status: going < event.capacity ? "going" : "waitlist",
          createdAt: new Date().toISOString(), checkin: null };
        d.registrations.push(reg);
        return { existing: false, ticket: ticketView(d, req, reg) };
      });
    }],

    ["GET", /^\/api\/tickets\/([A-Z2-9]{10})$/, (req, [code]) => {
      const reg = store.data.registrations.find((r) => r.code === code) || fail(404, "Ticket not found.");
      return ticketView(store.data, req, reg);
    }],

    ["POST", /^\/api\/tickets\/([A-Z2-9]{10})\/cancel$/, (req, [code]) => {
      const reg = store.data.registrations.find((r) => r.code === code) || fail(404, "Ticket not found.");
      if (reg.status === "cancelled") return ticketView(store.data, req, reg);
      if (reg.checkin) fail(409, "You've already checked in, so this registration can't be cancelled.");
      return store.mutate((d) => {
        const wasGoing = reg.status === "going";
        reg.status = "cancelled";
        const event = d.events.find((e) => e.id === reg.eventId);
        // A spot opened up: the longest-waiting person on the waitlist gets it. If seats were
        // released off the forecast and the event is still over capacity, nobody moves up.
        if (wasGoing && event && counts(d, reg.eventId).going < event.capacity) {
          const next = d.registrations
            .filter((r) => r.eventId === reg.eventId && r.status === "waitlist")
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          if (next) { next.status = "going"; next.promotedAt = new Date().toISOString(); next.promotedBy = "cancellation"; }
        }
        return ticketView(d, req, reg);
      });
    }],

    ["GET", /^\/api\/events\/([\w-]+)\/manage$/, (req, [id], url) => {
      const event = findEvent(id);
      requireManage(req, event);
      const d = store.data;
      if (url.searchParams.get("rev") === String(d.rev)) return { unchanged: true, rev: d.rev, now: new Date().toISOString() };
      const regs = d.registrations.filter((r) => r.eventId === id);
      return {
        rev: d.rev,
        now: new Date().toISOString(),
        event: publicEvent(d, req, event),
        registrations: regs,
        logs: d.logs.filter((l) => l.eventId === id).sort((a, b) => b.time.localeCompare(a.time)),
        directory: Object.values(d.directory),
        matcher: matcherSummary(d, id),
        forecast: forecastSummary(event),
      };
    }],

    ["POST", /^\/api\/events\/([\w-]+)\/checkin$/, async (req, [id]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const body = await readBody(req);
      return store.mutate((d) => checkIn(d, event, body));
    }],

    ["POST", /^\/api\/events\/([\w-]+)\/log$/, async (req, [id]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const b = await readBody(req);
      if (b.outcome !== "unresolved") fail(400, "Only unreadable scans can be logged directly.");
      store.mutate((d) => {
        d.logs.push({ uid: newId(), eventId: id, time: new Date().toISOString(), studentId: null, outcome: "unresolved",
          method: ["qr", "barcode", "ocr"].includes(b.method) ? b.method : "ocr" });
        const scan = b.scanId && (d.ocrScans || []).find((s) => s.id === b.scanId && s.eventId === id);
        if (scan && !scan.resolution) scan.resolution = "none";
      });
      return { ok: true };
    }],

    // OCR read in, ranked candidates and a decision out
    ["POST", /^\/api\/events\/([\w-]+)\/match$/, async (req, [id]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const body = await readBody(req);
      return store.mutate((d) => matchRead(d, event, body));
    }],

    // Forget what the matcher learned (the laptop running the server only)
    ["POST", /^\/api\/matcher\/reset$/, (req) => {
      if (!isLocal(req)) fail(403, "Only the laptop running SELAE can reset the matcher.");
      store.mutate((d) => { const t = d.matcher ? d.matcher.thresholds : undefined; d.matcher = emptyModel(); if (t) d.matcher.thresholds = t; });
      return { ok: true };
    }],

    ["POST", /^\/api\/events\/([\w-]+)\/registrations\/([\w-]+)\/promote$/, (req, [id, regId]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const reg = store.data.registrations.find((r) => r.id === regId && r.eventId === id) || fail(404, "Registration not found.");
      if (reg.status !== "waitlist") fail(409, "Only waitlisted guests can be moved to going.");
      store.mutate(() => { reg.status = "going"; reg.promotedAt = new Date().toISOString(); reg.promotedBy = "organizer"; });
      return { ok: true };
    }],

    // Let people in off the waitlist, as many as the turnout forecast says is safe (see forecast.js)
    ["POST", /^\/api\/events\/([\w-]+)\/release$/, async (req, [id]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const b = await readBody(req);
      const risk = typeof b.risk === "number" && b.risk > 0 && b.risk < 0.5 ? b.risk : DEFAULT_RISK;
      const f = forecastFor(event, risk);
      const k = Number.isInteger(b.count) ? Math.min(b.count, f.release) : f.release;
      if (k < 1) fail(409, f.ended ? "This event has already ended." : "The forecast doesn't leave room for anyone else at that risk.");
      const ids = new Set(f.waitlistOrder.slice(0, k));
      const now = new Date().toISOString();
      store.mutate((d) => {
        for (const r of d.registrations) if (ids.has(r.id) && r.status === "waitlist") {
          r.status = "going"; r.promotedAt = now; r.promotedBy = "forecast";
        }
      });
      return { released: ids.size, overflow: f.steps[k].overflow, empty: f.steps[k].empty };
    }],
  ];

  return async function handle(req, res, next) {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/")) return next ? next() : false;
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(payload));
    };
    try {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        if (req.method !== method) continue;
        send(200, await fn(req, m.slice(1), url));
        return true;
      }
      send(404, { error: "Not found." });
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message });
      else { console.error(e); send(500, { error: "Something went wrong on the server." }); }
    }
    return true;
  };
}

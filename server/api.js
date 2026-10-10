import os from "node:os";
import { newCode, newId, hashKey } from "./seed.js";

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

  const student = data.directory[studentId] || { id: studentId, last: "", first: "", middle: "", suffix: "", section: "" };
  if (!reg || reg.status === "cancelled") { log("notreg", studentId); return { outcome: "notreg", time: now, student }; }
  if (reg.status === "waitlist") { log("waitlist", studentId); return { outcome: "waitlist", time: now, student }; }
  if (reg.checkin) { log("dup", studentId); return { outcome: "dup", time: now, student, previous: reg.checkin }; }
  if (body.forceFull || counts(data, event.id).checkedIn >= event.capacity) { log("full", studentId); return { outcome: "full", time: now, student }; }
  reg.checkin = { time: now, method, confidence };
  log("approved", studentId, { confidence });
  return { outcome: "approved", time: now, student, checkin: reg.checkin };
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

export function createApi(store) {
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
        if (wasGoing) {
          // A spot opened up: the longest-waiting person on the waitlist gets it
          const next = d.registrations
            .filter((r) => r.eventId === reg.eventId && r.status === "waitlist")
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          if (next) next.status = "going";
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
      store.mutate((d) => d.logs.push({ uid: newId(), eventId: id, time: new Date().toISOString(), studentId: null, outcome: "unresolved",
        method: ["qr", "barcode", "ocr"].includes(b.method) ? b.method : "ocr" }));
      return { ok: true };
    }],

    ["POST", /^\/api\/events\/([\w-]+)\/registrations\/([\w-]+)\/promote$/, (req, [id, regId]) => {
      const event = findEvent(id);
      requireManage(req, event);
      const reg = store.data.registrations.find((r) => r.id === regId && r.eventId === id) || fail(404, "Registration not found.");
      if (reg.status !== "waitlist") fail(409, "Only waitlisted guests can be moved to going.");
      store.mutate(() => { reg.status = "going"; });
      return { ok: true };
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

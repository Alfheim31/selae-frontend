/* Talks to the SELAE server (server/api.js).

   This browser remembers two things in localStorage:
   - host keys for events created here (they unlock managing the event)
   - ticket codes registered from here (shown under My tickets)
   Clearing site data forgets them; the server still has the records. */

const KEYS = "selae.hostKeys";
const TICKETS = "selae.tickets";

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: still works for this visit */ }
}

export const hostKeys = {
  all: () => load(KEYS, {}),
  add(eventId, key) { save(KEYS, { ...hostKeys.all(), [eventId]: key }); },
};

export const myTickets = {
  all: () => load(TICKETS, []),
  add(code, eventId) {
    const list = myTickets.all().filter((t) => t.code !== code);
    save(TICKETS, [{ code, eventId, savedAt: new Date().toISOString() }, ...list]);
  },
  forEvent: (eventId) => myTickets.all().find((t) => t.eventId === eventId) || null,
  remove(code) { save(TICKETS, myTickets.all().filter((t) => t.code !== code)); },
};

async function request(method, path, body) {
  const keys = Object.values(hostKeys.all());
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (keys.length) headers["X-Selae-Host-Key"] = keys.join(",");
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach the SELAE server. Check that the laptop running it is on and you're on the same Wi-Fi.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

export const api = {
  info: () => request("GET", "/api/info"),
  events: () => request("GET", "/api/events"),
  event: (id) => request("GET", `/api/events/${id}`),
  async create(fields) {
    const out = await request("POST", "/api/events", fields);
    hostKeys.add(out.event.id, out.hostKey);
    return out.event;
  },
  update: (id, fields) => request("PATCH", `/api/events/${id}`, fields),
  async register(id, fields) {
    const out = await request("POST", `/api/events/${id}/register`, fields);
    myTickets.add(out.ticket.code, id);
    return out;
  },
  ticket: (code) => request("GET", `/api/tickets/${code}`),
  cancel: (code) => request("POST", `/api/tickets/${code}/cancel`),
  manage: (id, rev) => request("GET", `/api/events/${id}/manage${rev ? `?rev=${rev}` : ""}`),
  checkin: (id, body) => request("POST", `/api/events/${id}/checkin`, body),
  logUnresolved: (id, method) => request("POST", `/api/events/${id}/log`, { outcome: "unresolved", method }),
  promote: (id, regId) => request("POST", `/api/events/${id}/registrations/${regId}/promote`),
};

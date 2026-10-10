import { useEffect, useMemo, useState } from "react";
import { Calendar, MapPin, Users, Ticket, Plus, Settings, ScanLine, CheckCircle2, Clock, ArrowLeft } from "lucide-react";
import { api, myTickets } from "./api.js";
import {
  Cover, Mark, QrCode, go, fmtTime, fmtDate, fmtRange, formatName, tidyName, tidyInitial, COLORS,
} from "./shared.jsx";

/* ------------------------------------------------------------------
   Public pages, opened on attendees' phones over the local Wi-Fi:
   discover events, register, get a QR ticket, manage your tickets,
   and create your own event.
------------------------------------------------------------------- */

export function TopBar({ route }) {
  const at = (p) => (route === p ? "page" : undefined);
  return (
    <header className="topbar">
      <div className="wrap flex items-center justify-between gap-2 py-3">
        <button className="flex items-center gap-3" style={{ background: "none", border: 0, color: "inherit" }} onClick={() => go("")}>
          <Mark />
          <span className="text-lg font-bold" style={{ letterSpacing: "0.02em" }}>SELAE</span>
        </button>
        <nav className="flex items-center gap-1" aria-label="Main">
          <button className="toplink" aria-current={at("")} onClick={() => go("")}><Calendar size={16} /> <span className="hidden sm:inline">Events</span></button>
          <button className="toplink" aria-current={at("tickets")} onClick={() => go("tickets")}><Ticket size={16} /> <span className="hidden sm:inline">My tickets</span></button>
          <button className="btn btn-gold btn-sm ml-1" onClick={() => go("create")}><Plus size={16} /> Create<span className="hidden sm:inline">&nbsp;event</span></button>
        </nav>
      </div>
    </header>
  );
}

function usePolled(load, deps, ms) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const run = () => load().then((d) => { if (alive) { setData(d); setError(""); } }).catch((e) => { if (alive) setError(e.message); });
    run();
    const t = ms ? setInterval(run, ms) : 0;
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, error, setData];
}

function Loading() {
  return <div className="flex justify-center py-16"><div className="spin" aria-label="Loading" /></div>;
}
function ErrorBox({ message }) {
  return <div className="alert err" role="alert">{message}</div>;
}
function DateBox({ date }) {
  const d = new Date(date);
  return (
    <div className="datebox" aria-hidden="true">
      <div className="mo">{d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</div>
      <div className="dy">{d.getDate()}</div>
    </div>
  );
}

/* ---------------- discover ---------------- */
export function Discover() {
  const [events, error] = usePolled(() => api.events(), [], 10000);
  const [tab, setTab] = useState("upcoming");
  const list = (events || []).filter((e) => (tab === "upcoming" ? !e.isPast : e.isPast));
  const hosting = (events || []).filter((e) => e.canManage && !e.isPast);

  return (
    <div className="narrow py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold" style={{ fontSize: "clamp(1.8rem,5vw,2.4rem)", lineHeight: 1.1 }}>Events</h1>
          <p className="muted mt-1">Register in a few seconds and get a QR ticket for the entrance.</p>
        </div>
        <div className="seg" role="group" aria-label="Show">
          {[["upcoming", "Upcoming"], ["past", "Past"]].map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {!events && !error && <Loading />}

      {tab === "upcoming" && hosting.length > 0 && (
        <div className="text-sm muted flex items-center gap-2"><span className="pill host">Hosting</span> You manage {hosting.length === 1 ? "1 event" : `${hosting.length} events`} on this device.</div>
      )}

      <div className="flex flex-col gap-3">
        {list.map((e) => (
          <div key={e.id} className="evcard" role="link" tabIndex={0} style={{ cursor: "pointer" }}
            onClick={() => go(`e/${e.id}`)} onKeyDown={(k) => { if (k.key === "Enter") go(`e/${e.id}`); }}>
            <DateBox date={e.startsAt} />
            <div className="min-w-0 flex-1">
              <div className="text-sm muted">{fmtDate(e.startsAt, { weekday: "short" })}, {fmtTime(e.startsAt)}</div>
              <div className="font-bold text-lg truncate">{e.title}</div>
              <div className="text-sm muted truncate flex items-center gap-1"><MapPin size={14} style={{ flexShrink: 0 }} /> <span className="truncate">{e.venue}</span></div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {e.canManage && <span className="pill host">Hosting</span>}
                {myTickets.forEvent(e.id) && <span className="pill going">Registered</span>}
                <span className="text-sm faint">
                  {e.counts.going} going
                  {e.isPast ? "" : e.spotsLeft > 0 ? `, ${e.spotsLeft} spots left` : ", full (waitlist open)"}
                </span>
              </div>
            </div>
            <Cover event={e} thumb />
          </div>
        ))}
        {events && !list.length && (
          <div className="panel p-6 text-center flex flex-col items-center gap-3">
            <p className="muted">{tab === "upcoming" ? "No upcoming events yet." : "No past events."}</p>
            {tab === "upcoming" && <button className="btn btn-gold" onClick={() => go("create")}><Plus size={17} /> Create an event</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- event page ---------------- */
export function EventPage({ id }) {
  const [event, error] = usePolled(() => api.event(id), [id], 8000);
  const saved = myTickets.forEvent(id);
  const [ticket] = usePolled(() => (saved ? api.ticket(saved.code) : Promise.resolve(null)), [id, saved && saved.code], 0);
  const active = ticket && ticket.status !== "cancelled";

  if (error && !event) return <div className="narrow py-8"><ErrorBox message={error} /></div>;
  if (!event) return <Loading />;

  return (
    <div className="wrap py-8">
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-8">
        <div className="flex flex-col gap-4">
          <Cover event={event} />
          {event.hostName && (
            <div>
              <div className="text-sm faint">Hosted by</div>
              <div className="font-bold">{event.hostName}</div>
            </div>
          )}
          {event.canManage && (
            <div className="panel p-4 flex flex-col gap-2">
              <span className="pill host self-start">You're hosting</span>
              <button className="btn btn-gold" onClick={() => go(`m/${id}`)}><Settings size={16} /> Manage event</button>
              <button className="btn" onClick={() => go(`m/${id}/scanner`)}><ScanLine size={16} /> Open gate scanner</button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <div>
            {event.isPast && <span className="pill past mb-2">Ended</span>}
            <h1 className="font-bold" style={{ fontSize: "clamp(1.8rem,5vw,2.8rem)", lineHeight: 1.08, textWrap: "balance" }}>{event.title}</h1>
          </div>
          <div className="flex flex-col gap-3">
            <div className="factrow">
              <div className="facticon"><Calendar size={19} /></div>
              <div>
                <div className="font-bold">{fmtDate(event.startsAt)}</div>
                <div className="muted text-sm">{fmtTime(event.startsAt)} to {fmtTime(event.endsAt)}{new Date(event.startsAt).toDateString() !== new Date(event.endsAt).toDateString() ? ` (${fmtDate(event.endsAt, { month: "short", day: "numeric" })})` : ""}</div>
              </div>
            </div>
            <div className="factrow">
              <div className="facticon"><MapPin size={19} /></div>
              <div><div className="font-bold">{event.venue}</div></div>
            </div>
            <div className="factrow">
              <div className="facticon"><Users size={19} /></div>
              <div>
                <div className="font-bold">{event.counts.going} going</div>
                <div className="muted text-sm">{event.capacity} spots{event.counts.waitlist ? `, ${event.counts.waitlist} on the waitlist` : ""}</div>
              </div>
            </div>
          </div>

          <section className="panel p-5" aria-labelledby="reg-h">
            {active ? (
              <div className="flex flex-col gap-3">
                <h2 id="reg-h" className="font-bold text-lg flex items-center gap-2">
                  {ticket.checkin ? <><CheckCircle2 size={20} color="var(--ok)" /> You're checked in</>
                    : ticket.status === "going" ? <><CheckCircle2 size={20} color="var(--ok)" /> You're going</>
                    : <><Clock size={20} color="var(--warn)" /> You're on the waitlist</>}
                </h2>
                <p className="muted">
                  {ticket.status === "waitlist"
                    ? "You'll be moved to going automatically if someone cancels. Your ticket page will update."
                    : `Registered as ${formatName(ticket.student)}. Show your QR ticket at the entrance.`}
                </p>
                <button className="btn btn-gold self-start" onClick={() => go(`t/${ticket.code}`)}><Ticket size={17} /> View my ticket</button>
              </div>
            ) : event.isPast ? (
              <p id="reg-h" className="muted">This event has ended.</p>
            ) : !event.registrationOpen ? (
              <p id="reg-h" className="muted">Registration is closed. Contact the host if you need a spot.</p>
            ) : (
              <RegisterForm event={event} />
            )}
          </section>

          {event.description && (
            <section>
              <h2 className="font-bold text-lg mb-2" style={{ borderBottom: "1px solid var(--line)", paddingBottom: ".5rem" }}>About this event</h2>
              <p className="muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{event.description}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const SUFFIXES = ["", "Jr.", "Sr.", "II", "III", "IV"];

function RegisterForm({ event }) {
  const [f, setF] = useState({ first: "", middle: "", last: "", suffix: "", studentId: "", section: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const full = event.spotsLeft <= 0;
  const preview = useMemo(() => {
    const s = { first: tidyName(f.first), last: tidyName(f.last), middle: tidyInitial(f.middle), suffix: f.suffix };
    return s.first && s.last ? formatName(s) : "";
  }, [f]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const out = await api.register(event.id, f);
      go(`t/${out.ticket.code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 id="reg-h" className="font-bold text-lg">Registration</h2>
        <p className="muted text-sm">
          {full ? "This event is full. Join the waitlist and you'll get a spot automatically if someone cancels."
            : `${event.spotsLeft} of ${event.capacity} spots left.`}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label><span className="lbl">Given name</span><input className="inp" value={f.first} onChange={set("first")} autoComplete="given-name" required /></label>
        <label><span className="lbl">Middle name or initial <span className="faint">(optional)</span></span><input className="inp" value={f.middle} onChange={set("middle")} autoComplete="additional-name" /></label>
        <label><span className="lbl">Surname</span><input className="inp" value={f.last} onChange={set("last")} autoComplete="family-name" required /></label>
        <label><span className="lbl">Suffix <span className="faint">(optional)</span></span>
          <select className="inp" value={f.suffix} onChange={set("suffix")}>
            {SUFFIXES.map((s) => <option key={s} value={s}>{s || "None"}</option>)}
          </select>
        </label>
        <label><span className="lbl">Student number</span><input className="inp" value={f.studentId} onChange={set("studentId")} placeholder="2024-12345" inputMode="numeric" required /></label>
        <label><span className="lbl">Section</span><input className="inp" value={f.section} onChange={set("section")} placeholder="BSCS 3-4" required /></label>
        <label className="sm:col-span-2"><span className="lbl">Email <span className="faint">(optional)</span></span><input className="inp" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></label>
      </div>
      {preview && <p className="text-sm muted">On the guest list as <strong style={{ color: "var(--text)" }}>{preview}</strong></p>}
      {error && <ErrorBox message={error} />}
      <button className="btn btn-gold" type="submit" disabled={busy}>{busy ? "Registering…" : full ? "Join the waitlist" : "Register"}</button>
    </form>
  );
}

/* ---------------- ticket ---------------- */
const prettyCode = (c) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

export function TicketPage({ code }) {
  const [ticket, error, setTicket] = usePolled(() => api.ticket(code), [code], 4000);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => { if (ticket && ticket.event) myTickets.add(code, ticket.event.id); }, [ticket, code]);

  if (error && !ticket) return <div className="narrow py-8"><ErrorBox message={error} /></div>;
  if (!ticket) return <Loading />;
  const { event, student } = ticket;
  const cancelled = ticket.status === "cancelled";

  const cancel = async () => {
    setBusy(true); setActionError("");
    try { setTicket(await api.cancel(code)); setConfirming(false); } catch (e) { setActionError(e.message); }
    setBusy(false);
  };

  return (
    <div className="narrow py-8 flex flex-col gap-4" style={{ maxWidth: 460 }}>
      <button className="toplink self-start" onClick={() => go(`e/${event.id}`)}><ArrowLeft size={16} /> Event page</button>
      <div className="ticket">
        <div className="p-5 flex flex-col gap-1">
          <div className="text-sm faint">{event.hostName || "SELAE event"}</div>
          <h1 className="font-bold text-2xl" style={{ lineHeight: 1.15 }}>{event.title}</h1>
          <div className="muted">{fmtRange(event.startsAt, event.endsAt)}</div>
          <div className="muted flex items-center gap-1"><MapPin size={15} /> {event.venue}</div>
        </div>
        <div className="stub p-5 flex flex-col items-center gap-3 text-center">
          {ticket.checkin ? <span className="pill going"><CheckCircle2 size={15} /> Checked in at {fmtTime(ticket.checkin.time)}</span>
            : ticket.status === "going" ? <span className="pill going">You're going</span>
            : ticket.status === "waitlist" ? <span className="pill waitlist">On the waitlist</span>
            : <span className="pill cancelled">Registration cancelled</span>}
          <div>
            <div className="font-bold text-xl">{formatName(student)}</div>
            <div className="muted text-sm">{student.id}{student.section ? `, ${student.section}` : ""}</div>
          </div>
          {!cancelled && (
            <>
              <QrCode value={ticket.qr} size={240} label={`QR ticket for ${formatName(student)}`} />
              <div className="faint text-sm" style={{ letterSpacing: ".08em" }}>{prettyCode(ticket.code)}</div>
              <p className="muted text-sm" style={{ maxWidth: "32ch" }}>
                {ticket.status === "waitlist"
                  ? "This QR code starts working at the gate once you're moved off the waitlist."
                  : ticket.checkin ? "You're in. Enjoy the event." : "Show this at the entrance. Turn your screen brightness up."}
              </p>
            </>
          )}
        </div>
      </div>

      {actionError && <ErrorBox message={actionError} />}
      {!cancelled && !ticket.checkin && !event.isPast && (
        confirming ? (
          <div className="panel p-4 flex flex-col gap-3">
            <p>Cancel your registration? {ticket.status === "going" ? "Your spot goes to the next person on the waitlist." : ""}</p>
            <div className="flex gap-2">
              <button className="btn" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} disabled={busy} onClick={cancel}>Yes, cancel</button>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep my spot</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost self-center" onClick={() => setConfirming(true)}>Cancel registration</button>
        )
      )}
      {cancelled && !event.isPast && event.registrationOpen && (
        <button className="btn btn-gold self-center" onClick={() => go(`e/${event.id}`)}>Register again</button>
      )}
    </div>
  );
}

/* ---------------- my tickets ---------------- */
export function MyTickets() {
  const saved = myTickets.all();
  const [tickets, error] = usePolled(
    () => Promise.all(saved.map((t) => api.ticket(t.code).catch(() => ({ code: t.code, missing: true })))),
    [saved.map((t) => t.code).join()], 0,
  );

  return (
    <div className="narrow py-8 flex flex-col gap-5">
      <div>
        <h1 className="font-bold" style={{ fontSize: "clamp(1.8rem,5vw,2.4rem)", lineHeight: 1.1 }}>My tickets</h1>
        <p className="muted mt-1">Tickets registered from this device.</p>
      </div>
      {error && <ErrorBox message={error} />}
      {!saved.length && (
        <div className="panel p-6 text-center flex flex-col items-center gap-3">
          <p className="muted">No tickets on this device yet.</p>
          <button className="btn btn-gold" onClick={() => go("")}>Find an event</button>
        </div>
      )}
      {saved.length > 0 && !tickets && <Loading />}
      <div className="flex flex-col gap-3">
        {(tickets || []).map((t) => t.missing ? (
          <div key={t.code} className="evcard justify-between">
            <span className="muted">Ticket {prettyCode(t.code)} no longer exists on the server.</span>
            <button className="btn btn-sm" onClick={() => { myTickets.remove(t.code); window.location.reload(); }}>Remove</button>
          </div>
        ) : (
          <button key={t.code} className="evcard" onClick={() => go(`t/${t.code}`)}>
            <DateBox date={t.event.startsAt} />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-lg truncate">{t.event.title}</div>
              <div className="text-sm muted">{fmtDate(t.event.startsAt, { weekday: "short", month: "short", day: "numeric" })}, {fmtTime(t.event.startsAt)}</div>
              <div className="mt-2">
                {t.checkin ? <span className="pill going">Checked in</span>
                  : t.status === "going" ? <span className="pill going">Going</span>
                  : t.status === "waitlist" ? <span className="pill waitlist">Waitlist</span>
                  : <span className="pill cancelled">Cancelled</span>}
              </div>
            </div>
            <Cover event={t.event} thumb />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- create / edit ---------------- */
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function EventForm({ initial, submitLabel, onSubmit, showRegistrationToggle = false }) {
  const defaults = useMemo(() => {
    const s = new Date(); s.setDate(s.getDate() + 1); s.setHours(13, 0, 0, 0);
    const e = new Date(s.getTime() + 2 * 3600000);
    return { title: "", hostName: "", venue: "", capacity: 100, description: "", color: "gold", visibility: "public",
      registrationOpen: true, startsAt: toLocalInput(s), endsAt: toLocalInput(e) };
  }, []);
  const [f, setF] = useState(() => (initial
    ? { ...defaults, ...initial, startsAt: toLocalInput(initial.startsAt), endsAt: toLocalInput(initial.endsAt) }
    : defaults));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => { setSaved(false); setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    const starts = new Date(f.startsAt), ends = new Date(f.endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) { setError("Pick a start and end time."); setBusy(false); return; }
    try {
      await onSubmit({
        title: f.title, hostName: f.hostName, venue: f.venue, description: f.description, color: f.color, visibility: f.visibility,
        capacity: Number(f.capacity), startsAt: starts.toISOString(), endsAt: ends.toISOString(),
        ...(showRegistrationToggle ? { registrationOpen: f.registrationOpen } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-5 items-start">
        <div className="flex flex-col gap-3">
          <Cover event={{ title: f.title || "Event name", color: f.color }} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Cover color">
            {Object.entries(COLORS).map(([k, [a, b]]) => (
              <button key={k} type="button" className="swatch" aria-label={k} aria-pressed={f.color === k}
                style={{ background: `linear-gradient(140deg, ${a}, ${b})` }} onClick={() => setF((x) => ({ ...x, color: k }))} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <label><span className="lbl">Event name</span>
            <input className="inp" style={{ fontSize: "1.25rem", fontWeight: 700 }} value={f.title} onChange={set("title")} placeholder="GDG Study Jam: Intro to Flutter" required /></label>
          <label><span className="lbl">Hosted by</span>
            <input className="inp" value={f.hostName} onChange={set("hostName")} placeholder="Your org's name" /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label><span className="lbl">Starts</span><input className="inp" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} required /></label>
            <label><span className="lbl">Ends</span><input className="inp" type="datetime-local" value={f.endsAt} onChange={set("endsAt")} required /></label>
          </div>
          <label><span className="lbl">Venue</span><input className="inp" value={f.venue} onChange={set("venue")} placeholder="GV Room 301" required /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label><span className="lbl">Capacity</span><input className="inp" type="number" min="1" max="100000" value={f.capacity} onChange={set("capacity")} required /></label>
            <label><span className="lbl">Visibility</span>
              <select className="inp" value={f.visibility} onChange={set("visibility")}>
                <option value="public">Public: listed on Events</option>
                <option value="unlisted">Unlisted: only people with the link</option>
              </select>
            </label>
          </div>
          <label><span className="lbl">Description <span className="faint">(optional)</span></span>
            <textarea className="inp" value={f.description} onChange={set("description")} placeholder="What should attendees know or bring?" /></label>
          {showRegistrationToggle && (
            <label className="flex items-center gap-3 font-bold">
              <input type="checkbox" checked={f.registrationOpen} onChange={set("registrationOpen")} style={{ width: 20, height: 20, accentColor: "var(--gold)" }} />
              Registration open
            </label>
          )}
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {saved && showRegistrationToggle && <div className="alert ok" role="status">Saved.</div>}
      <button className="btn btn-gold self-start" type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}

export function CreateEvent() {
  return (
    <div className="narrow py-8 flex flex-col gap-5">
      <div>
        <h1 className="font-bold" style={{ fontSize: "clamp(1.8rem,5vw,2.4rem)", lineHeight: 1.1 }}>Create an event</h1>
        <p className="muted mt-1">You'll get a registration page to share and a gate scanner for check-in. Only this device can manage it, unless you share the host link.</p>
      </div>
      <EventForm submitLabel="Create event" onSubmit={async (fields) => { const e = await api.create(fields); go(`m/${e.id}`); }} />
    </div>
  );
}

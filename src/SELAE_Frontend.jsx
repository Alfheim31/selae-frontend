import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import {
  LayoutDashboard, ScanLine, BarChart3, Search, CheckCircle2, XCircle, AlertTriangle, Camera, CameraOff,
  Volume2, VolumeX, Lock, Download, History, HelpCircle, Ban, Keyboard, Printer, QrCode as QrIcon, Settings,
  ArrowLeft, ExternalLink, Copy, Clock, CalendarX, WifiOff,
} from "lucide-react";
import { useBarcodeScanner, parseStudentId } from "./barcode.js";
import { useBeep, HoldToExit, useCamera, CameraStage } from "./camera.jsx";
import { api, hostKeys } from "./api.js";
import {
  CSS, Mark, QrCode, go, useHashRoute, useToast, fmtTime, fmtDate, fmtDateShort, formatName, norm, pct, lev, misread,
  METHOD_LABEL, METHOD_SHORT, OUTCOME_LABEL,
} from "./shared.jsx";
import { TopBar, Discover, EventPage, TicketPage, MyTickets, CreateEvent, EventForm } from "./public.jsx";

/* ------------------------------------------------------------------
   SELAE — Smart Event Logistics and Analytics Engine

   Public side (phones on the venue Wi-Fi): browse events, register,
   get a QR ticket. Organizer side (the laptop at the gate): live
   dashboard, gate scanner, analytics, test tickets, settings.

   Routes (hash-based, so any static server works):
     #/                 events          #/e/:id        event page
     #/create           create event    #/t/:code      ticket
     #/tickets          my tickets      #/m/:id/:tab   manage an event
     #/host/:id/:key    accept a co-host link
------------------------------------------------------------------- */

const TABS = ["dashboard", "scanner", "analytics", "tickets", "settings"];
const LEGACY = { dashboard: "dashboard", scanner: "scanner", analytics: "analytics", testids: "tickets" };
const TICKET_RE = /^SELAE1:[a-z0-9-]+:[A-Z2-9]{10}$/;

export default function App() {
  const route = useHashRoute();
  const parts = route.split("/").filter(Boolean);

  // Old single-event links (#scanner etc.) open the demo event
  useEffect(() => {
    if (parts.length === 1 && LEGACY[parts[0]]) go(`m/demo-ga/${LEGACY[parts[0]]}`);
    if (parts[0] === "host" && parts[1] && parts[2]) { hostKeys.add(parts[1], parts[2]); go(`m/${parts[1]}`); }
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  let page;
  if (parts[0] === "m" && parts[1]) {
    page = <Manage id={parts[1]} tab={TABS.includes(parts[2]) ? parts[2] : "dashboard"} />;
  } else {
    const inner =
      parts[0] === "e" && parts[1] ? <EventPage id={parts[1]} /> :
      parts[0] === "t" && parts[1] ? <TicketPage code={parts[1]} /> :
      parts[0] === "tickets" ? <MyTickets /> :
      parts[0] === "create" ? <CreateEvent /> :
      <Discover />;
    page = <><TopBar route={parts[0] || ""} />{inner}</>;
  }

  return (
    <div className="selae">
      <style>{CSS}</style>
      {page}
    </div>
  );
}

/* ---------------- server state for one event ---------------- */
function toData(s) {
  const byId = new Map(s.directory.map((x) => [x.id, x]));
  const student = (sid) => byId.get(sid) || { id: sid, first: "", last: "", middle: "", suffix: "", section: "" };
  const regs = s.registrations;
  const going = regs.filter((r) => r.status === "going");
  const waitlist = regs.filter((r) => r.status === "waitlist").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const checkins = new Map(regs.filter((r) => r.checkin).map((r) => [r.studentId, { ...r.checkin, time: new Date(r.checkin.time) }]));
  return {
    event: s.event,
    capacity: s.event.capacity,
    opens: new Date(s.event.startsAt),
    ends: new Date(s.event.endsAt),
    byId, student, regs, going, waitlist, checkins,
    registered: new Set(going.map((r) => r.studentId)),
    regByStudent: new Map(regs.filter((r) => r.status !== "cancelled").map((r) => [r.studentId, r])),
    students: going.map((r) => student(r.studentId)),
    log: s.logs.map((l) => ({ uid: l.uid, time: new Date(l.time), sid: l.studentId, outcome: l.outcome, method: l.method, confidence: l.confidence })),
  };
}

function useManage(id) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const rev = useRef(null);
  const refresh = useCallback(async () => {
    try {
      const d = await api.manage(id, rev.current);
      if (!d.unchanged) { rev.current = d.rev; setState(d); }
      setError("");
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => {
    rev.current = null;
    setState(null);
    refresh();
    // Poll so registrations from phones and check-ins from other gates show up within ~2 seconds
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);
  const data = useMemo(() => (state ? toData(state) : null), [state]);
  return { data, error, refresh };
}

/* ---------------- organizer shell ---------------- */
function Manage({ id, tab }) {
  const { data, error, refresh } = useManage(id);
  const [gateMode, setGateMode] = useState(false);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useToast();
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  if (!data) {
    return (
      <>
        <TopBar route="" />
        <div className="narrow py-10">
          {error ? (
            <div className="panel p-6 flex flex-col gap-3">
              <h1 className="font-bold text-xl">{/hosts/.test(error) ? "You don't manage this event on this device" : "Couldn't load this event"}</h1>
              <p className="muted">{/hosts/.test(error)
                ? "Events can be managed from the device that created them, from the laptop running SELAE, or by opening a co-host link."
                : error}</p>
              <button className="btn self-start" onClick={() => go(`e/${id}`)}>View the event page</button>
            </div>
          ) : <div className="flex justify-center py-16"><div className="spin" aria-label="Loading" /></div>}
        </div>
      </>
    );
  }

  const { event } = data;
  const setTab = (t) => go(`m/${id}/${t}`);
  const nav = [
    { id: "dashboard", label: "Live dashboard", icon: LayoutDashboard },
    { id: "scanner", label: "Gate scanner", icon: ScanLine },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "tickets", label: "Test tickets", icon: QrIcon },
    { id: "settings", label: "Invite & settings", icon: Settings },
  ];
  const live = now >= new Date(data.opens.getTime() - 3600000) && now <= data.ends;
  const status = now > data.ends ? <><span className="dot" style={{ background: "var(--faint)" }} /> Ended {fmtDateShort(data.ends)}</>
    : live ? <><span className="dot" style={{ background: "var(--ok)" }} /> Check-in open<span className="faint font-normal">, now {fmtTime(now)}</span></>
    : <><Clock size={15} /> Starts {fmtDateShort(data.opens)}, {fmtTime(data.opens)}</>;

  return (
    <div className="flex min-h-screen">
      {!gateMode && (
        <aside className="rail hidden md:flex flex-col w-60 shrink-0 p-4 gap-6">
          <div className="flex items-center gap-3 px-1 pt-1">
            <Mark />
            <div>
              <div className="text-lg font-bold" style={{ letterSpacing: "0.02em" }}>SELAE</div>
              <div className="text-xs faint">Event check-in</div>
            </div>
          </div>
          <button className="navbtn" onClick={() => go("")}><ArrowLeft size={18} /> All events</button>
          <nav className="flex flex-col gap-1" aria-label="Manage event">
            {nav.map((n) => (
              <button key={n.id} className="navbtn" aria-current={tab === n.id ? "page" : undefined} onClick={() => setTab(n.id)}>
                <n.icon size={18} /> {n.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto text-sm px-1 flex flex-col gap-1">
            <div className="faint">Current event</div>
            <div className="font-bold">{event.title}</div>
            <div className="muted">{event.venue}</div>
            <button className="navbtn mt-1" style={{ padding: ".4rem 0" }} onClick={() => go(`e/${id}`)}><ExternalLink size={15} /> Public page</button>
          </div>
        </aside>
      )}

      <main className="flex-1 min-w-0">
        {!gateMode && (
          <header className="px-4 md:px-6 pt-5 pb-3 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-bold">{event.title}</h1>
                <p className="muted text-sm">{event.venue}, {fmtDate(data.opens, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
              </div>
              <div className="flex items-center gap-2 text-sm font-bold">
                {error && <span className="chip" style={{ color: "var(--warn)", borderColor: "#7F5424" }}><WifiOff size={13} /> Reconnecting</span>}
                {status}
              </div>
            </div>
            <nav className="mnav flex md:hidden" aria-label="Manage event">
              <button className="navbtn" onClick={() => go("")}><ArrowLeft size={16} /> Events</button>
              {nav.map((n) => (
                <button key={n.id} className="navbtn" aria-current={tab === n.id ? "page" : undefined} onClick={() => setTab(n.id)}>
                  <n.icon size={16} /> {n.label}
                </button>
              ))}
            </nav>
          </header>
        )}
        <div className={gateMode ? "p-3 md:p-5" : "p-4 md:p-6"}>
          {tab === "dashboard" && <Dashboard data={data} now={now} refresh={refresh} onToast={setToast} onOpen={setTab} />}
          {tab === "scanner" && <Scanner data={data} eventId={id} refresh={refresh} gateMode={gateMode} setGateMode={setGateMode} />}
          {tab === "analytics" && <Analytics data={data} now={now} onToast={setToast} />}
          {tab === "tickets" && <TestTickets data={data} eventId={id} onOpenScanner={() => setTab("scanner")} />}
          {tab === "settings" && <SettingsPage data={data} eventId={id} refresh={refresh} />}
        </div>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ---------------- share / invite ---------------- */
function useShareBase() {
  const [base, setBase] = useState(window.location.origin);
  const [lan, setLan] = useState(null);
  useEffect(() => {
    api.info().then((i) => {
      // On the server laptop, localhost links won't open on phones: use the Wi-Fi address instead
      if (i.isLocal && i.lanUrls.length) { setBase(i.lanUrls[0]); setLan(true); } else setLan(!i.isLocal);
    }).catch(() => setLan(false));
  }, []);
  return { base, lan };
}

function CopyRow({ value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement("textarea"); t.value = value; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* ignore */ } t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return (
    <div className="copyrow">
      <input className="inp" readOnly value={value} onFocus={(e) => e.target.select()} aria-label="Link" />
      <button className="btn" onClick={copy}><Copy size={16} /> {done ? "Copied" : "Copy"}</button>
    </div>
  );
}

function ShareCard({ eventId }) {
  const { base, lan } = useShareBase();
  const url = `${base}/#/e/${eventId}`;
  return (
    <section className="panel p-5 flex flex-col sm:flex-row gap-5 items-center">
      <QrCode value={url} size={170} label="QR code for the registration page" />
      <div className="flex flex-col gap-3 min-w-0 flex-1 w-full">
        <div>
          <h2 className="font-bold text-lg">Invite people to register</h2>
          <p className="muted text-sm">Put this QR code on a poster or slide, or send the link in your group chat. It opens the registration page on their phone.</p>
        </div>
        <CopyRow value={url} />
        {lan === false && base.includes("localhost") && (
          <p className="text-sm" style={{ color: "var(--warn)" }}>This laptop isn't on a network, so phones can't open this link yet. Connect to Wi-Fi and reload.</p>
        )}
        {lan && <p className="text-sm faint">Phones need to be on the same Wi-Fi as the laptop running SELAE.</p>}
      </div>
    </section>
  );
}

function SettingsPage({ data, eventId, refresh }) {
  const key = hostKeys.all()[eventId];
  const { base } = useShareBase();
  return (
    <div className="flex flex-col gap-6" style={{ maxWidth: 860 }}>
      <ShareCard eventId={eventId} />
      {key && (
        <section className="panel p-5 flex flex-col gap-3">
          <div>
            <h2 className="font-bold text-lg">Co-host link</h2>
            <p className="muted text-sm">Anyone who opens this can run the dashboard and gate scanner for this event. Share it only with your organizers.</p>
          </div>
          <CopyRow value={`${base}/#/host/${eventId}/${key}`} />
        </section>
      )}
      <section className="panel p-5 flex flex-col gap-4">
        <h2 className="font-bold text-lg">Event details</h2>
        <EventForm key={data.event.id} initial={data.event} submitLabel="Save changes" showRegistrationToggle
          onSubmit={async (fields) => { await api.update(eventId, fields); await refresh(); }} />
      </section>
    </div>
  );
}

/* ---------------- dashboard ---------------- */
function arrivalBuckets(checkins, now, opens, ends) {
  const times = [...checkins.values()].map((c) => c.time.getTime());
  let start = times.length ? Math.min(opens.getTime(), ...times) : opens.getTime();
  let end = Math.min(now.getTime(), ends.getTime());
  if (times.length) end = Math.max(end, Math.max(...times) + 1);
  if (end <= start) return { size: 5, buckets: [] };
  const span = (end - start) / 60000;
  const size = [5, 10, 15, 30, 60, 120, 240, 1440].find((s) => span / s <= 30) || 1440;
  start = Math.floor(start / (size * 60000)) * size * 60000;
  const n = Math.max(1, Math.ceil((end - start) / (size * 60000)));
  const buckets = Array.from({ length: n }, (_, i) => {
    const t = new Date(start + i * size * 60000);
    return { label: size >= 1440 ? fmtDateShort(t) : fmtTime(t), count: 0 };
  });
  for (const t of times) {
    const i = Math.floor((t - start) / (size * 60000));
    if (i >= 0 && i < n) buckets[i].count++;
  }
  return { size, buckets };
}
const everyLabel = (size) => (size >= 1440 ? "per day" : size >= 60 ? `every ${size / 60} hour${size > 60 ? "s" : ""}` : `every ${size} minutes`);

const chartTip = { background: "#1A2C55", border: "1px solid #263A69", borderRadius: 10, color: "#EAF0FB" };

function MethodChip({ method, confidence }) {
  if (!method) return null;
  const conf = (method === "ocr" || method === "confirmed") && confidence != null ? ` ${pct(confidence)}` : "";
  return <span className={`chip ${method}`} title={METHOD_LABEL[method]}>{METHOD_SHORT[method]}{conf}</span>;
}

function OutcomeIcon({ outcome }) {
  const map = {
    approved: [CheckCircle2, "var(--ok)"], notreg: [XCircle, "#FF7B7D"], dup: [History, "#8FB0FF"],
    full: [Ban, "#FF7B7D"], unresolved: [HelpCircle, "var(--warn)"], waitlist: [Clock, "var(--warn)"], wrongevent: [CalendarX, "#FF7B7D"],
  };
  const [Icon, color] = map[outcome] || map.unresolved;
  return <Icon size={20} color={color} aria-label={OUTCOME_LABEL[outcome]} />;
}

function Dashboard({ data, now, refresh, onToast, onOpen }) {
  const { students, registered, checkins, log, student, capacity, opens, ends, waitlist, event } = data;
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const count = checkins.size;
  const fill = count / capacity;
  const fillColor = fill >= 1 ? "var(--bad)" : fill >= 0.9 ? "var(--warn)" : "var(--ok)";
  const last10 = [...checkins.values()].filter((c) => now - c.time <= 10 * 60000).length;
  const attention = log.filter((l) => l.outcome !== "approved");
  const { size, buckets } = useMemo(() => arrivalBuckets(checkins, now, opens, ends), [checkins, now, opens, ends]);
  const notYet = Math.max(0, registered.size - [...registered].filter((sid) => checkins.has(sid)).length);

  const rows = useMemo(() => {
    const n = norm(q);
    const base = filter === "waitlist" ? waitlist.map((r) => ({ ...student(r.studentId), reg: r })) : students.map((s) => ({ ...s }));
    return base
      .filter((s) => (filter === "in" ? checkins.has(s.id) : filter === "out" ? !checkins.has(s.id) : true))
      .filter((s) => !n || norm(s.id).includes(n) || norm(s.last + s.first).includes(n) || norm(s.first + s.last).includes(n))
      .sort((a, b) => (filter === "waitlist" ? 0 : formatName(a).localeCompare(formatName(b))));
  }, [students, waitlist, student, checkins, filter, q]);

  const promote = async (reg) => {
    try { await api.promote(event.id, reg.id); await refresh(); onToast(`${formatName(student(reg.studentId))} moved to going`); }
    catch (e) { onToast(e.message); }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Capacity band */}
      <section aria-labelledby="cap-h" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="cap-h" className="sr-only">Venue capacity</h2>
            <div className="flex items-baseline gap-3">
              <span className="font-bold" style={{ fontSize: "clamp(2.6rem,6vw,3.6rem)", lineHeight: 1 }}>{count}</span>
              <span className="text-lg muted">checked in of {capacity} venue capacity</span>
            </div>
          </div>
          <button className="btn btn-gold" onClick={() => onOpen("scanner")}><ScanLine size={18} /> Open gate scanner</button>
        </div>
        <div className="capbar" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={capacity} aria-label="Checked in versus capacity">
          <div className="capfill" style={{ width: `${Math.min(100, fill * 100)}%`, background: fillColor }} />
          <div className="captick" style={{ left: `${Math.min(100, (registered.size / capacity) * 100)}%` }} title="Registered attendees" />
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
          {[
            ["Registered", registered.size, waitlist.length ? `${notYet} not yet arrived, ${waitlist.length} on waitlist` : `${notYet} not yet arrived`],
            ["Show-up so far", pct(count / registered.size), "of registered students"],
            ["Last 10 minutes", `+${last10}`, "new check-ins"],
            ["Needs attention", attention.length, "unregistered, repeat, or unreadable scans"],
          ].map(([k, v, s]) => (
            <div key={k} style={{ borderLeft: "2px solid var(--line)", paddingLeft: ".8rem" }}>
              <dt className="text-sm muted">{k}</dt>
              <dd className="text-2xl font-bold">{v}</dd>
              <dd className="text-xs faint">{s}</dd>
            </div>
          ))}
        </dl>
      </section>

      {registered.size === 0 && waitlist.length === 0 && <ShareCard eventId={event.id} />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6 min-w-0">
          <section className="panel p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">Arrivals {everyLabel(size)}</h2>
              <span className="text-sm faint">{buckets.length ? `From ${buckets[0].label}` : `Opens ${fmtTime(opens)}`}</span>
            </div>
            <div style={{ height: 210 }}>
              {buckets.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={buckets} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#263A69" strokeDasharray="3 4" />
                    <XAxis dataKey="label" tick={{ fill: "#A3B1D0", fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "rgba(127,162,255,.08)" }} contentStyle={chartTip} formatter={(v) => [v, "Arrivals"]} />
                    <Bar dataKey="count" fill="#7FA2FF" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center muted text-center">No arrivals yet. The chart fills in as people check in.</div>
              )}
            </div>
          </section>

          <section className="panel flex flex-col min-w-0">
            <div className="p-4 md:p-5 flex flex-wrap gap-3 items-center justify-between">
              <h2 className="font-bold text-lg">Guest list</h2>
              <div className="seg" role="group" aria-label="Filter guests">
                {[["all", `Going ${registered.size}`], ["in", `Checked in ${count}`], ["out", `Not yet ${notYet}`],
                  ...(waitlist.length ? [["waitlist", `Waitlist ${waitlist.length}`]] : [])].map(([k, l]) => (
                  <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              <label className="field w-full">
                <Search size={17} />
                <input className="input" placeholder="Search by name or student number, e.g. pena or 2024-" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
            <div style={{ maxHeight: 420, overflow: "auto", borderTop: "1px solid var(--line)" }}>
              <table className="tbl">
                <thead>
                  <tr><th>Name</th><th>Student number</th><th>Section</th><th>Status</th><th>{filter === "waitlist" ? "" : "Identified by"}</th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const c = checkins.get(s.id);
                    return (
                      <tr key={s.id}>
                        <td className="font-bold">{formatName(s)}</td>
                        <td className="muted">{s.id}</td>
                        <td className="muted">{s.section}</td>
                        <td>{s.reg ? <span className="chip confirmed">Waitlist since {fmtDateShort(s.reg.createdAt)}</span>
                          : c ? <span className="chip in">In at {fmtTime(c.time)}</span> : <span className="faint">Not yet</span>}</td>
                        <td>{s.reg ? <button className="btn btn-sm" onClick={() => promote(s.reg)}>Move to going</button>
                          : c ? <MethodChip method={c.method} confidence={c.confidence} /> : null}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={5} className="muted" style={{ padding: "1.5rem" }}>
                      {q ? `No guest matches “${q}”. Check the spelling or try the student number.` : "Nobody here yet."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="panel p-4 md:p-5 min-w-0" aria-labelledby="feed-h">
          <h2 id="feed-h" className="font-bold text-lg">Recent scans</h2>
          <p className="text-sm faint mb-2">Newest first, including scans that didn't check anyone in.</p>
          <ul className="feed" style={{ maxHeight: 760, overflow: "auto" }}>
            {log.slice(0, 18).map((l) => {
              const s = l.sid ? student(l.sid) : null;
              return (
                <li key={l.uid}>
                  <OutcomeIcon outcome={l.outcome} />
                  <div className="min-w-0">
                    <div className="font-bold truncate">{s ? formatName(s) : "Unidentified ID"}</div>
                    <div className="text-sm muted">{OUTCOME_LABEL[l.outcome]}{s && s.section ? `, ${s.section}` : ""}</div>
                    {l.outcome === "approved" && <div className="mt-1"><MethodChip method={l.method} confidence={l.confidence} /></div>}
                  </div>
                  <time className="text-sm faint">{fmtTime(l.time)}</time>
                </li>
              );
            })}
            {!log.length && <li style={{ display: "block" }} className="muted">No scans yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ---------------- gate scanner ---------------- */
const SCENARIOS = [
  ["clean", "Clean QR ticket read"],
  ["ocr", "Glare, OCR succeeds"],
  ["lowconf", "Glare, low-confidence OCR"],
  ["unreadable", "Unreadable ID"],
  ["notreg", "Not registered"],
  ["dup", "Already checked in"],
  ["full", "Venue at capacity (simulated)"],
];

function makeActions(data) {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const withStudent = (r) => ({ reg: r, student: data.student(r.studentId) });
  return {
    isRegistered: (sid) => data.registered.has(sid),
    pickFor(kind) {
      if (kind === "notreg") {
        const pool = [...data.byId.values()].filter((s) => !data.regByStudent.has(s.id));
        return pool.length ? { student: rnd(pool) } : null;
      }
      if (kind === "dup") {
        const pool = data.going.filter((r) => r.checkin);
        return pool.length ? withStudent(rnd(pool)) : null;
      }
      const pool = data.going.filter((r) => !r.checkin);
      return pool.length ? withStudent(rnd(pool)) : null;
    },
    // Fuzzy match of an OCR read against this event's guest list
    candidates(read) {
      return data.going
        .map((r) => ({ id: r.studentId, d: lev(read, r.studentId) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map(({ id, d }, i) => ({ student: data.student(id), confidence: Math.max(0.31, 0.79 - d * 0.13 - i * 0.03 - Math.random() * 0.05) }));
    },
    search(q) {
      const n = norm(q);
      if (n.length < 2) return [];
      return [...data.byId.values()]
        .filter((s) => norm(s.id).includes(n) || norm(s.last + s.first).includes(n) || norm(s.first + s.last).includes(n))
        .sort((a, b) => Number(data.registered.has(b.id)) - Number(data.registered.has(a.id)))
        .slice(0, 6);
    },
  };
}

function Scanner({ data, eventId, refresh, gateMode, setGateMode }) {
  const { checkins, capacity, event } = data;
  const actions = useMemo(() => makeActions(data), [data]);
  const [phase, setPhase] = useState("idle"); // idle | barcode | ocr | checking | result
  const [result, setResult] = useState(null);
  const [card, setCard] = useState(null);
  const [glare, setGlare] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [deviceId, setDeviceId] = useState(null);
  const cam = useCamera(cameraOn, deviceId);
  const live = cam.state === "live";
  const cameraUsable = cameraOn && cam.state !== "off";
  const [sound, setSound] = useState(true);
  const [path, setPath] = useState([]); // pipeline steps reached
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const timers = useRef([]);
  const scanToken = useRef(0); // ignores server replies for a scan that was reset in the meantime
  const beep = useBeep(sound);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => clearTimers, []);
  const focusManual = () => setTimeout(() => inputRef.current && inputRef.current.focus(), 50);

  const reset = () => {
    clearTimers();
    scanToken.current++;
    setPhase("idle"); setResult(null); setCard(null); setGlare(false); setPath([]);
    cam.resume();
  };

  const show = (r) => { setResult(r); setPath((p) => [...p, "result"]); setPhase("result"); cam.freeze(); };

  // The final decision is made by the server (Logical Layer): registration, waitlist, duplicates, capacity
  const decide = async (target, method, confidence, opts = {}) => {
    const token = ++scanToken.current;
    setPhase("checking");
    let res;
    try {
      res = await api.checkin(eventId, { ...target, method, confidence, forceFull: Boolean(opts.forceFull) });
    } catch (e) {
      if (token !== scanToken.current) return;
      show({ type: "error", message: e.message });
      beep("error");
      return;
    }
    if (token !== scanToken.current) return;
    refresh();
    const student = res.student;
    if (res.outcome === "approved") {
      show({ type: "approved", student, method, confidence, time: new Date(res.time) });
      beep("ok");
      later(reset, 3500);
    } else if (res.outcome === "unresolved") {
      show({ type: "unknown", read: target.ticket || target.studentId });
      beep("error");
    } else {
      show({ type: res.outcome, student, method, otherEvent: res.otherEvent,
        previous: res.previous ? { ...res.previous, time: new Date(res.previous.time) } : null });
      beep(res.outcome === "dup" ? "attention" : "error");
      if (res.outcome === "dup") later(reset, 5000);
    }
  };

  // A code was decoded from the live camera feed: a SELAE QR ticket, or a student ID barcode
  const handleDecoded = (raw) => {
    clearTimers();
    setCard(null); setGlare(false); setResult(null);
    setPath(["barcode"]);
    const text = raw.trim();
    if (TICKET_RE.test(text)) { decide({ ticket: text }, "qr", 1); return; }
    const id = parseStudentId(text);
    if (id) { decide({ studentId: id }, "barcode", 1); return; }
    api.logUnresolved(eventId, "barcode").then(refresh).catch(() => {});
    show({ type: "unknown", read: text.length > 40 ? text.slice(0, 40) + "…" : text });
    beep("error");
  };
  const scannerStatus = useBarcodeScanner({
    videoRef: cam.videoRef,
    running: live,
    ready: phase === "idle" && !result,
    onDetect: handleDecoded,
  });

  const run = (kind) => {
    if (!cameraUsable) return;
    reset();
    const pick = actions.pickFor(kind);
    if (!pick) {
      setResult({ type: "error", message: kind === "dup" ? "Nobody has checked in yet, so there's no one to scan twice."
        : kind === "notreg" ? "Every student on file is registered for this event."
        : "Everyone on the guest list has already checked in." });
      setPhase("result");
      return;
    }
    const { student, reg } = pick;
    const needsOcr = ["ocr", "lowconf", "unreadable"].includes(kind);
    setCard(student);
    setGlare(needsOcr);
    setPhase("barcode");
    setPath(["barcode"]);
    if (!needsOcr) {
      later(() => (reg && (kind === "clean" || kind === "dup")
        ? decide({ ticket: `SELAE1:${eventId}:${reg.code}` }, "qr", 1)
        : decide({ studentId: student.id }, "barcode", 1, { forceFull: kind === "full" })), 900);
      return;
    }
    later(() => { setPhase("ocr"); setPath(["barcode", "ocr"]); }, 1100);
    later(() => {
      setPath(["barcode", "ocr", "match"]);
      if (kind === "ocr") {
        decide({ studentId: student.id }, "ocr", 0.9 + Math.random() * 0.08);
      } else if (kind === "lowconf") {
        const read = misread(student.id);
        setResult({ type: "confirm", read, candidates: actions.candidates(read) });
        setPhase("result");
        beep("attention");
      } else {
        api.logUnresolved(eventId, "ocr").then(refresh).catch(() => {});
        setResult({ type: "unresolved" });
        setPhase("result");
        beep("error");
        focusManual();
      }
    }, 2400);
  };

  const suggestions = actions.search(q);
  const chooseManual = (s) => {
    reset();
    setQ("");
    setCard(null);
    setPath(["manual"]);
    decide({ studentId: s.id }, "manual", null);
  };

  const busy = phase === "barcode" || phase === "ocr" || phase === "checking";
  const count = checkins.size;

  const stepState = (id) => {
    if (!path.length) return "";
    if (id === "result") return phase === "result" ? "active" : "";
    if (path.includes(id)) return path[path.length - 1] === id && phase !== "result" ? "active" : "done";
    return phase === "result" ? "skipped" : "";
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Gate header: event context and live headcount stay visible */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {gateMode && <Mark />}
          <div>
            <div className="text-sm muted">{gateMode ? event.title : "Gate scanner"}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{count}</span>
              <span className="muted">of {capacity} checked in</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} {sound ? "Sound on" : "Sound off"}
          </button>
          {cam.devices.length > 1 && live && (
            <select className="camselect" aria-label="Camera" value={deviceId || cam.devices[0].deviceId}
              onChange={(e) => { reset(); setDeviceId(e.target.value); }}>
              {cam.devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
              ))}
            </select>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => { reset(); setCameraOn((c) => !c); }}>
            {cameraOn ? <CameraOff size={16} /> : <Camera size={16} />} {cameraOn ? "Turn camera off" : "Turn camera on"}
          </button>
          {gateMode ? <HoldToExit onExit={() => setGateMode(false)} /> : (
            <button className="btn btn-sm btn-gold" onClick={() => setGateMode(true)}><Lock size={15} /> Enter gate mode</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Camera */}
        <div className="lg:col-span-3 min-w-0">
          <div className="viewfinder">
            <video ref={cam.videoRef} className={phase === "result" ? "frozen" : ""} autoPlay playsInline muted />

            {live ? (
              <>
                <div className="vf-status">
                  <span className="dot" style={{ background: scannerStatus === "error" ? "var(--warn)" : "var(--ok)" }} />
                  {scannerStatus === "ready" ? "Scanning for QR tickets and ID barcodes" : scannerStatus === "error" ? "Code reader failed to load, use manual entry" : "Camera live, loading code reader"}
                </div>
                <div className="frame" aria-hidden="true">
                  <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                  {phase === "barcode" && <div className="sweep" />}
                </div>
                {phase === "ocr" && <div className="ocr-tag">Reading the printed student number</div>}
                {phase === "idle" && <div className="vf-note">Hold the QR ticket or ID barcode inside the frame. If it doesn't read, move it closer.</div>}
                {phase === "result" && <div className="vf-note">Frame held</div>}
              </>
            ) : cameraOn && cam.state !== "starting" ? (
              <>
                {/* No feed: the illustrated ID keeps the demo scenarios legible */}
                <div className={`idcard ${card ? "" : "away"}`} aria-hidden="true">
                  <div className="band">UNIVERSITY STUDENT ID</div>
                  <div className="photo" />
                  <div className="info">
                    <div className="ln" style={{ width: "85%" }} />
                    <div className="ln" style={{ width: "60%" }} />
                    <div className={`num ${phase === "ocr" ? "reading" : ""}`}>{card ? card.id : "0000-00000"}</div>
                  </div>
                  <div className="bars" />
                  {glare && <div className="glare" />}
                </div>
                {phase === "idle" && (
                  <CameraStage cam={cam} onRetry={() => { setDeviceId(null); setCameraOn(false); setTimeout(() => setCameraOn(true), 60); }}
                    onUseIllustration={() => setCameraOn(false)} />
                )}
                {phase !== "idle" && (
                  <div className="frame" aria-hidden="true">
                    <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
                    {phase === "barcode" && <div className="sweep" />}
                  </div>
                )}
                {phase === "ocr" && <div className="ocr-tag">Reading the printed student number</div>}
              </>
            ) : (
              <CameraStage cam={cam} onRetry={() => { setCameraOn(true); }} onUseIllustration={() => setCameraOn(false)} />
            )}
          </div>
        </div>

        {/* Result panel: sits right under the camera on small screens */}
        <div className="lg:col-span-2 lg:row-span-2 min-w-0" aria-live="assertive">
          <ResultPanel phase={phase} result={result} camera={cameraUsable} live={live} capacity={capacity} onReset={reset}
            onConfirm={(c) => decide({ studentId: c.student.id }, "confirmed", c.confidence)}
            onNone={() => { api.logUnresolved(eventId, "ocr").then(refresh).catch(() => {}); reset(); focusManual(); }}
            onManual={() => { reset(); focusManual(); }} />
        </div>

        {/* Pipeline + manual entry */}
        <div className="lg:col-span-3 flex flex-col gap-4 min-w-0">
          <ol className="steps" aria-label="Identification steps">
            {[["barcode", "QR / barcode"], ["ocr", "Student number (OCR)"], ["match", "Fuzzy match"], ["result", "Result"]].map(([id, label]) => (
              <li key={id} className={`step ${stepState(id)}`}>{label}</li>
            ))}
          </ol>

          <div className="panel p-4">
            <label htmlFor="manual" className="flex items-center gap-2 font-bold mb-2"><Keyboard size={17} /> Manual entry</label>
            <div className="field" style={{ position: "relative" }}>
              <Search size={17} />
              <input id="manual" ref={inputRef} className="input" autoComplete="off" value={q}
                placeholder="Type a student number or name, e.g. 2024- or dela cruz"
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (!suggestions.length) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === "Enter") { e.preventDefault(); chooseManual(suggestions[active]); }
                  if (e.key === "Escape") setQ("");
                }} />
              {q.length >= 2 && (
                <div className="suggest" role="listbox">
                  {suggestions.length ? suggestions.map((s, i) => (
                    <button key={s.id} role="option" aria-selected={i === active} data-active={i === active} onClick={() => chooseManual(s)}>
                      <span><span className="font-bold">{formatName(s)}</span> <span className="muted text-sm">{s.section}</span></span>
                      <span className="text-sm faint">{s.id}{actions.isRegistered(s.id) ? "" : ", not registered"}</span>
                    </button>
                  )) : <div className="p-3 muted">No student matches “{q}”.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <details className="demo panel p-4" open={!gateMode}>
        <summary>Demo scenarios for testing and presentations</summary>
        <div className="flex flex-wrap gap-2 mt-3">
          {SCENARIOS.map(([k, label]) => (
            <button key={k} className="btn btn-sm" disabled={busy || !cameraUsable || result?.type === "confirm"} onClick={() => run(k)}>{label}</button>
          ))}
        </div>
      </details>
    </div>
  );
}

function ResultPanel({ phase, result, camera, live, capacity, onReset, onConfirm, onNone, onManual }) {
  if (phase === "barcode" || phase === "ocr" || phase === "checking") {
    const title = phase === "checking" ? "Checking the guest list" : phase === "barcode" ? "Reading code" : "Barcode unreadable";
    const text = phase === "checking" ? "One moment." : phase === "barcode" ? "Keep it steady inside the frame." : "Reading the printed student number instead. Keep the ID still.";
    return (
      <div className="result idle">
        <div className="state"><ScanLine size={24} color="var(--gold)" /> {title}</div>
        <p className="muted text-lg">{text}</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="result idle">
        <div className="state">{camera ? <ScanLine size={24} color="var(--gold)" /> : <AlertTriangle size={24} color="var(--warn)" />} {camera ? "Ready for the next attendee" : "Scanning paused"}</div>
        <p className="muted text-lg">{camera
          ? (live
            ? "Camera is live. Ask the attendee to show their QR ticket, or the barcode on their student ID, inside the frame. It checks in as soon as the code is read. The OCR fallback is still simulated, so use the demo scenarios for that path."
            : "Ask the attendee to show their QR ticket or student ID inside the frame. If the code can't be read, SELAE reads the printed student number.")
          : "The camera is off. Use manual entry to keep checking attendees in."}</p>
      </div>
    );
  }

  const Meta = ({ s }) => (
    <dl className="meta">
      <dt>Student number</dt><dd className="font-bold">{s.id}</dd>
      <dt>Section</dt><dd className="font-bold">{s.section || "Not on file"}</dd>
    </dl>
  );

  switch (result.type) {
    case "approved":
      return (
        <div className="result ok">
          <div className="state"><CheckCircle2 size={28} /> Checked in</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">
            {result.method === "qr" && "Identified by QR ticket"}
            {result.method === "barcode" && "Identified by ID barcode"}
            {result.method === "ocr" && `Identified by OCR, ${pct(result.confidence)} match`}
            {result.method === "confirmed" && `Confirmed by operator, ${pct(result.confidence)} match`}
            {result.method === "manual" && "Entered manually"}
            {` at ${fmtTime(result.time)}`}
          </p>
          <div className="countdown" aria-hidden="true"><div style={{ animationDuration: "3.5s" }} /></div>
        </div>
      );
    case "dup":
      return (
        <div className="result dup">
          <div className="state"><History size={28} /> Already checked in</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">First checked in at {fmtTime(result.previous.time)} ({METHOD_LABEL[result.previous.method]}). No second entry was recorded.</p>
          <div className="countdown" aria-hidden="true"><div style={{ animationDuration: "5s" }} /></div>
        </div>
      );
    case "notreg":
      return (
        <div className="result bad">
          <div className="state"><XCircle size={28} /> Not registered for this event</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">This student isn't on the guest list. They can register on their phone from the event page, if spots are left.</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "waitlist":
      return (
        <div className="result bad">
          <div className="state"><Clock size={28} /> On the waitlist</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">This guest registered after the event filled up and hasn't been given a spot. An organizer can move them to going from the dashboard.</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "wrongevent":
      return (
        <div className="result bad">
          <div className="state"><CalendarX size={28} /> Ticket for a different event</div>
          <div className="who">{result.student ? formatName(result.student) : "Unknown guest"}</div>
          <p className="font-bold">
            This QR ticket is for {result.otherEvent ? `“${result.otherEvent.title}” on ${fmtDateShort(result.otherEvent.startsAt)}` : "another event"}, not this one.
          </p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "full":
      return (
        <div className="result bad">
          <div className="state"><Ban size={28} /> Venue at capacity</div>
          <div className="who">{formatName(result.student)}</div>
          <Meta s={result.student} />
          <p className="font-bold">The venue has reached its {capacity}-person limit. Hold entry and notify an organizer before admitting anyone else.</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>Next attendee</button>
        </div>
      );
    case "confirm":
      return (
        <div className="result warn">
          <div className="state"><AlertTriangle size={28} /> Confirm this attendee</div>
          <p className="text-lg">The student number was hard to read. SELAE read <strong>{result.read}</strong>. Check the ID and choose the matching student.</p>
          <div className="flex flex-col gap-2">
            {result.candidates.map((c, i) => (
              <button key={c.student.id} className="cand" onClick={() => onConfirm(c)} autoFocus={i === 0}>
                <span>
                  <span className="font-bold text-lg block">{formatName(c.student)}</span>
                  <span>{c.student.id}, {c.student.section}</span>
                </span>
                <span className="font-bold">{pct(c.confidence)}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-on mt-auto" onClick={onNone}>None of these, type it instead</button>
        </div>
      );
    case "unknown":
      return (
        <div className="result warn">
          <div className="state"><HelpCircle size={28} /> Not a ticket for this system</div>
          <p className="text-lg">The code read <strong style={{ wordBreak: "break-all" }}>{result.read}</strong>, but it isn't a SELAE ticket or a student number on file. Check the ticket, then type the student number or name in manual entry.</p>
          <div className="flex flex-col gap-2 mt-auto">
            <button className="btn btn-on" onClick={onManual} autoFocus><Keyboard size={16} /> Go to manual entry</button>
            <button className="btn btn-on" onClick={onReset}>Next attendee</button>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="result warn">
          <div className="state"><WifiOff size={28} /> Couldn't check in</div>
          <p className="text-lg">{result.message}</p>
          <button className="btn btn-on mt-auto" onClick={onReset} autoFocus>OK</button>
        </div>
      );
    default:
      return (
        <div className="result warn">
          <div className="state"><HelpCircle size={28} /> Couldn't read this ID</div>
          <p className="text-lg">Neither the barcode nor the student number could be read. Type the student number or name in manual entry.</p>
          <button className="btn btn-on mt-auto" onClick={onManual}><Keyboard size={16} /> Go to manual entry</button>
        </div>
      );
  }
}

/* ---------------- analytics ---------------- */
const METHOD_COLOR = { qr: "#7FA2FF", barcode: "#B9CBFF", ocr: "#E4B23E", confirmed: "#F39A3D", manual: "#7384AB" };

function Analytics({ data, now, onToast }) {
  const { students, registered, checkins, log, opens, ends, event } = data;
  const attended = checkins.size;
  const reg = registered.size;

  const stats = useMemo(() => {
    const times = [...checkins.values()].map((c) => c.time.getTime()).sort((a, b) => a - b);
    let best = { count: 0, start: opens.getTime() };
    for (let i = 0, j = 0; i < times.length; i++) {
      while (times[i] - times[j] >= 10 * 60000) j++;
      if (i - j + 1 > best.count) best = { count: i - j + 1, start: times[j] };
    }
    const methods = { qr: 0, barcode: 0, ocr: 0, confirmed: 0, manual: 0 };
    for (const c of checkins.values()) methods[c.method] = (methods[c.method] || 0) + 1;
    let running = 0;
    const { buckets } = arrivalBuckets(checkins, now, opens, ends);
    const cumulative = buckets.map((b) => ({ label: b.label, total: (running += b.count) }));
    const sections = [...new Set(students.map((s) => s.section || "No section"))].sort();
    const bySection = sections.map((section) => {
      const inSec = students.filter((s) => (s.section || "No section") === section);
      return { section, registered: inSec.length, attended: inSec.filter((s) => checkins.has(s.id)).length };
    });
    const failed = {};
    for (const k of ["notreg", "dup", "unresolved", "full", "waitlist", "wrongevent"]) failed[k] = log.filter((l) => l.outcome === k).length;
    return { best, methods, cumulative, bySection, failed };
  }, [checkins, log, now, students, opens, ends]);

  const { best, methods, cumulative, bySection, failed } = stats;
  const rescued = methods.ocr + methods.confirmed;

  const exportCsv = () => {
    const rows = [["Name", "Student number", "Section", "Checked in at", "Identified by"]];
    [...checkins.keys()]
      .map((sid) => data.student(sid))
      .sort((a, b) => formatName(a).localeCompare(formatName(b)))
      .forEach((s) => {
        const c = checkins.get(s.id);
        rows.push([formatName(s), s.id, s.section, `${fmtDateShort(c.time)} ${fmtTime(c.time)}`, METHOD_LABEL[c.method]]);
      });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    try {
      // BOM keeps ñ intact when the file is opened in Excel
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `selae-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event"}-attendance.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast(`Exported ${attended} attendees`);
    } catch (e) {
      onToast("Export isn't available in this preview");
    }
  };

  const methodKeys = Object.keys(methods).filter((k) => methods[k] > 0 || ["qr", "ocr", "manual"].includes(k));
  const failedText = [
    `${failed.notreg} unregistered`, `${failed.dup} repeat scans blocked`, `${failed.unresolved} unreadable`,
    failed.waitlist ? `${failed.waitlist} on the waitlist` : "", failed.wrongevent ? `${failed.wrongevent} tickets for other events` : "",
    failed.full ? `${failed.full} turned away at capacity` : "",
  ].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div style={{ maxWidth: 720 }}>
          <h2 className="font-bold" style={{ fontSize: "clamp(1.6rem,3.6vw,2.4rem)", lineHeight: 1.15 }}>
            {attended} of {reg} registered students checked in.
          </h2>
          <p className="text-lg muted mt-2">
            That's a {pct(attended / reg)} show-up rate.
            {best.count > 1 ? ` The busiest 10 minutes started at ${fmtTime(new Date(best.start))}, with ${best.count} arrivals.` : ""}
            {" "}Figures update live while check-in is open.
          </p>
        </div>
        <button className="btn btn-gold" onClick={exportCsv} disabled={!attended}><Download size={18} /> Export attendance (CSV)</button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="panel p-4 md:p-5 min-w-0">
          <h3 className="font-bold text-lg">Check-ins over time</h3>
          <p className="text-sm faint mb-3">Running total against the {reg} registered students</p>
          <div style={{ height: 240 }}>
            {cumulative.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulative} margin={{ top: 10, right: 26, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7FA2FF" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#7FA2FF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#263A69" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={{ fill: "#A3B1D0", fontSize: 12 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis domain={[0, Math.max(1, reg)]} tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={chartTip} formatter={(v) => [v, "Checked in"]} />
                  <Area type="monotone" dataKey="total" stroke="#7FA2FF" strokeWidth={2.5} fill="url(#cum)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center muted">No check-ins yet.</div>}
          </div>
        </section>

        <section className="panel p-4 md:p-5 min-w-0">
          <h3 className="font-bold text-lg">How attendees were identified</h3>
          <p className="mt-1 mb-4 muted">
            The OCR fallback identified <strong style={{ color: "var(--text)" }}>{rescued}</strong> attendees whose codes couldn't be read,
            {" "}{pct(rescued / Math.max(1, attended))} of all check-ins.
          </p>
          <div className="flex w-full overflow-hidden" style={{ height: 22, borderRadius: 999, background: "var(--bg)" }}
            role="img" aria-label={methodKeys.map((k) => `${METHOD_LABEL[k]} ${methods[k]}`).join(", ")}>
            {methodKeys.map((k) => (
              <div key={k} style={{ width: `${(methods[k] / Math.max(1, attended)) * 100}%`, background: METHOD_COLOR[k] }} />
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5">
            {methodKeys.map((k) => (
              <div key={k} className="flex items-center gap-3">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: METHOD_COLOR[k], flexShrink: 0 }} />
                <dt className="muted flex-1">{METHOD_LABEL[k]}</dt>
                <dd className="font-bold">{methods[k]}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 pt-4 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="font-bold mb-1">Scans that didn't check anyone in</div>
            <p className="muted">{failedText}.</p>
          </div>
        </section>

        <section className="panel p-4 md:p-5 min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="font-bold text-lg">Attendance by section</h3>
            <div className="flex gap-4 text-sm muted">
              <span className="flex items-center gap-2"><span style={{ width: 12, height: 12, borderRadius: 3, background: "#34497D" }} /> Registered</span>
              <span className="flex items-center gap-2"><span style={{ width: 12, height: 12, borderRadius: 3, background: "#7FA2FF" }} /> Checked in</span>
            </div>
          </div>
          <div style={{ height: Math.max(120, bySection.length * 38) }}>
            {bySection.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySection} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }} barGap={-14} barCategoryGap="28%">
                  <CartesianGrid horizontal={false} stroke="#263A69" strokeDasharray="3 4" />
                  <XAxis type="number" tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="section" width={92} tick={{ fill: "#A3B1D0", fontSize: 13 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgba(127,162,255,.06)" }} contentStyle={chartTip}
                    formatter={(v, name) => [v, name === "attended" ? "Checked in" : "Registered"]} />
                  <Bar dataKey="registered" fill="#34497D" barSize={14} radius={[0, 5, 5, 0]} />
                  <Bar dataKey="attended" fill="#7FA2FF" barSize={14} radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center muted">No registrations yet.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------- test tickets ---------------- */
/* Live QR codes for guests of this event, so the scanner can be tested
   and demoed without anyone's phone. Groups update as people check in. */
function TestTickets({ data, eventId, onOpenScanner }) {
  const groups = useMemo(() => {
    const ticket = (r) => ({ key: r.id, student: data.student(r.studentId), value: `SELAE1:${eventId}:${r.code}` });
    const notReg = [...data.byId.values()].filter((s) => !data.regByStudent.has(s.id)).slice(0, 3);
    return [
      { key: "ok", title: "Going, not yet checked in", expect: "Checks in (green)", list: data.going.filter((r) => !r.checkin).slice(0, 6).map(ticket) },
      { key: "dup", title: "Already checked in", expect: "Already checked in (blue)", list: data.going.filter((r) => r.checkin).slice(0, 3).map(ticket) },
      { key: "wait", title: "On the waitlist", expect: "On the waitlist (red)", list: data.waitlist.slice(0, 3).map(ticket) },
      { key: "notreg", title: "Student ID only, not registered", expect: "Not registered (red)",
        note: "These encode a student number, like the barcode on a student ID.",
        list: notReg.map((s) => ({ key: s.id, student: s, value: s.id })) },
    ].filter((g) => g.list.length);
  }, [data, eventId]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end justify-between gap-4 noprint">
        <div style={{ maxWidth: 720 }}>
          <h2 className="font-bold text-2xl">Test tickets</h2>
          <p className="muted mt-1">
            Real QR tickets for guests of this event. Print this page, or open it on a phone and hold the screen up to the webcam on
            the Gate scanner. Each group shows the result you should get. The groups update as people check in.
          </p>
          <p className="faint text-sm mt-2">The best test is a real one: register on your phone from the event page, then scan the ticket you get.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => window.print()}><Printer size={17} /> Print</button>
          <button className="btn btn-gold" onClick={onOpenScanner}><ScanLine size={17} /> Open gate scanner</button>
        </div>
      </section>

      {!groups.length && <p className="muted">Nobody is registered yet. Share the event page from Invite &amp; settings.</p>}
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold text-lg">{g.title}</h3>
            <span className="text-sm faint">Expected: {g.expect}</span>
          </div>
          {g.note && <p className="text-sm faint" style={{ marginTop: "-.4rem" }}>{g.note}</p>}
          <div className="testgrid">
            {g.list.map((t) => (
              <div key={t.key} className="testcard">
                <div className="font-bold">{formatName(t.student)}</div>
                <div className="text-sm" style={{ color: "#4A5675" }}>{t.student.id}{t.student.section ? `, ${t.student.section}` : ""}</div>
                <QrCode value={t.value} size={170} label={`QR code for ${formatName(t.student)}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

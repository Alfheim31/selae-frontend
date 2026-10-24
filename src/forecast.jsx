import { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Area } from "recharts";
import { Brain, TrendingUp, TrendingDown, UserPlus } from "lucide-react";
import { forecastNow } from "../server/forecast.js";
import { api } from "./api.js";
import { pct, formatName } from "./shared.jsx";

/* ------------------------------------------------------------------
   Turnout forecast and waitlist release (the model is server/forecast.js).

   The server sends each registration's chance of showing up and the
   arrival curve from past events; the browser re-runs the forecast
   every few seconds, because "not here yet" changes the odds as
   check-in goes on.
------------------------------------------------------------------- */

const chartTip = { background: "#1A2C55", border: "1px solid #263A69", borderRadius: 10, color: "#EAF0FB" };
const RISKS = [[0.01, "1%"], [0.05, "5%"], [0.1, "10%"]];
const round = (n) => Math.round(n);

export function useForecast(data, now, risk) {
  return useMemo(() => {
    if (!data.forecast) return null;
    const { event } = data;
    return forecastNow({ capacity: event.capacity, startsAt: event.startsAt, endsAt: event.endsAt, regs: data.regs,
      preds: data.forecast.preds, arrival: data.forecast.arrival, spread: data.forecast.spread, now, risk });
  }, [data, now, risk]);
}

/** A guest's chance of coming, with what drove it on hover. */
export function Likely({ p, why, compact = false }) {
  if (p == null) return null;
  const color = p >= 0.7 ? "var(--ok)" : p >= 0.4 ? "var(--muted)" : "var(--warn)";
  const reasons = (why || []).map((w) => `${w.up ? "+" : "−"} ${w.text}`).join("\n");
  return (
    <span title={reasons ? `Chance of coming. Why:\n${reasons}` : undefined} className="flex flex-col" style={{ cursor: reasons ? "help" : undefined }}>
      <span className="font-bold" style={{ color }}>{pct(p)}</span>
      {!compact && why && why[0] && <span className="text-xs faint">{why[0].text}</span>}
    </span>
  );
}

export function TurnoutPanel(props) {
  return props.f && props.data.forecast ? <TurnoutPanelInner {...props} /> : null;
}

function TurnoutPanelInner({ data, f, risk, setRisk, refresh, onToast }) {
  const [busy, setBusy] = useState(false);
  const { model } = data.forecast;
  const { headcount, steps, release, ended, minutes } = f;
  const pending = data.going.filter((r) => !r.checkin);
  const waitlist = data.waitlist;
  const stillExpected = headcount.expected - headcount.inside;
  const before = minutes < 0;

  const lowest = useMemo(() => pending
    .map((r) => ({ r, p: f.live[r.id], why: data.forecast.preds[r.id] ? data.forecast.preds[r.id].why : [] }))
    .sort((a, b) => a.p - b.p).slice(0, 5), [pending, f, data.forecast]);

  const doRelease = async () => {
    if (!window.confirm(`Move the first ${release} people on the waitlist to going? Their tickets update right away.`)) return;
    setBusy(true);
    try {
      const out = await api.release(data.event.id, risk);
      onToast(`${out.released} people moved up off the waitlist`);
      await refresh();
    } catch (e) { onToast(e.message); }
    setBusy(false);
  };

  const chart = steps.map((s) => ({ k: s.k, empty: Math.round(s.empty * 10) / 10, overflow: Math.round(s.overflow * 1000) / 10 }));
  const chosen = steps[release];

  return (
    <section className="panel p-4 md:p-5" aria-labelledby="fc-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fc-h" className="font-bold text-lg flex items-center gap-2"><Brain size={19} /> Turnout forecast</h2>
        <span className="text-sm faint">
          {model.ready
            ? `Learned from ${model.examples} registrations at ${model.events} past events${model.simulated ? ` (${model.simulated} simulated)` : ""}`
            : "Not enough past events yet, so this uses the average show-up rate"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-bold" style={{ fontSize: "2.6rem", lineHeight: 1 }}>{ended ? headcount.inside : round(headcount.expected)}</span>
            <span className="muted">{ended ? "attended" : "expected final headcount"}</span>
          </div>
          {!ended && <p className="muted">90% likely between <strong style={{ color: "var(--text)" }}>{headcount.lo}</strong> and{" "}
            <strong style={{ color: "var(--text)" }}>{headcount.hi}</strong>, against {data.capacity} seats.</p>}
          <p className="muted">
            {ended ? "Check-in has closed. This event now teaches the forecast for future ones."
              : before ? `Of the ${pending.length} people going, about ${round(stillExpected)} are expected to come (${pct(stillExpected / Math.max(1, pending.length))}). Past events here averaged ${pct(model.baseRate)}.`
              : `${headcount.inside} are in. Of the ${pending.length} who haven't arrived, about ${round(stillExpected)} are still expected: by ${round(minutes)} minutes in, about ${pct(f.share)} of attendees have usually arrived.`}
          </p>

          {!ended && lowest.length > 0 && (
            <div className="mt-1">
              <div className="font-bold mb-1">Least likely to come</div>
              <p className="text-sm faint mb-2">Worth a reminder message. Hover a name for the reasons.</p>
              <ul className="flex flex-col gap-1">
                {lowest.map(({ r, p, why }) => (
                  <li key={r.id} className="flex justify-between gap-3" title={why.map((w) => `${w.up ? "+" : "−"} ${w.text}`).join("\n")}>
                    <span className="truncate">{formatName(data.student(r.studentId))}
                      <span className="text-sm faint"> {why.filter((w) => !w.up).map((w) => w.text).slice(0, 2).join(", ")}</span></span>
                    <span className="font-bold" style={{ color: p < 0.4 ? "var(--warn)" : "var(--muted)" }}>{pct(p)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold flex items-center gap-2"><UserPlus size={17} /> Waitlist release</div>
            <div className="flex items-center gap-2">
              <span className="text-sm faint">Overflow risk</span>
              <div className="seg" role="group" aria-label="Overflow risk you'll accept">
                {RISKS.map(([v, l]) => <button key={v} aria-pressed={risk === v} onClick={() => setRisk(v)}>{l}</button>)}
              </div>
            </div>
          </div>

          {ended ? <p className="muted">The event has ended.</p>
            : !waitlist.length ? (
              <p className="muted">Nobody is on the waitlist. If the event fills up, SELAE will work out how many waitlisted people can
                safely be let in, because not everyone who registers comes.</p>
            ) : (
              <>
                <p className="muted">
                  {release > 0
                    ? <>Let <strong style={{ color: "var(--text)" }}>{release} of {waitlist.length}</strong> waitlisted people in. Expected empty
                        seats drop from <strong style={{ color: "var(--text)" }}>{round(steps[0].empty)}</strong> to{" "}
                        <strong style={{ color: "var(--text)" }}>{round(chosen.empty)}</strong>; the chance more people come than the venue
                        holds is <strong style={{ color: "var(--text)" }}>{pct(chosen.overflow)}</strong>.</>
                    : <>At this risk there's no room for anyone else: with everyone already going, the chance of overflowing is{" "}
                        {pct(steps[0].overflow)}.</>}
                </p>
                <div style={{ height: 170 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 6, right: 0, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#263A69" strokeDasharray="3 4" />
                      <XAxis dataKey="k" tick={{ fill: "#A3B1D0", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={16} />
                      <YAxis yAxisId="e" tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis yAxisId="o" orientation="right" domain={[0, 100]} unit="%" width={44} tick={{ fill: "#7384AB", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTip} labelFormatter={(k) => `Release ${k}`}
                        formatter={(v, n) => (n === "empty" ? [v, "Expected empty seats"] : [`${v}%`, "Chance of overflow"])} />
                      <Area yAxisId="e" type="monotone" dataKey="empty" stroke="#7FA2FF" fill="rgba(127,162,255,.15)" strokeWidth={2} />
                      <Line yAxisId="o" type="monotone" dataKey="overflow" stroke="#F39A3D" strokeWidth={2} dot={false} />
                      <ReferenceLine yAxisId="e" x={release} stroke="#E4B23E" strokeDasharray="4 3" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex gap-4 text-xs muted">
                  <span className="flex items-center gap-2"><span style={{ width: 12, height: 3, background: "#7FA2FF" }} /> Expected empty seats</span>
                  <span className="flex items-center gap-2"><span style={{ width: 12, height: 3, background: "#F39A3D" }} /> Chance of overflow</span>
                  <span className="flex items-center gap-2"><span style={{ width: 12, height: 3, background: "#E4B23E" }} /> Recommended</span>
                </div>
                <button className="btn btn-gold self-start" disabled={!release || busy} onClick={doRelease}>
                  <UserPlus size={17} /> {release ? `Release ${release} spot${release === 1 ? "" : "s"}` : "Nothing to release"}
                </button>
                <p className="text-xs faint">People move up in waitlist order. The gate still turns anyone away once the venue is full.</p>
              </>
            )}
        </div>
      </div>
    </section>
  );
}

/* For Analytics: how well the model does on events it wasn't trained on, and what it learned. */
export function TurnoutModelPanel({ forecast }) {
  if (!forecast) return null;
  const { model } = forecast;
  const h = model.holdout;
  const weights = [...(model.weights || [])].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const maxW = Math.max(0.01, ...weights.map((w) => Math.abs(w.weight)));
  const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
  return (
    <section className="panel p-4 md:p-5 min-w-0 lg:col-span-2">
      <style>{".fc-tbl td,.fc-tbl th{white-space:normal;padding:.55rem .6rem}.fc-tbl th:first-child,.fc-tbl td:first-child{padding-left:0}"}</style>
      <h3 className="font-bold text-lg flex items-center gap-2"><Brain size={19} /> Turnout model</h3>
      <p className="muted mt-1" style={{ maxWidth: 760 }}>
        A logistic regression learns each registration's chance of showing up from past events: how far ahead people registered,
        their own record, year level, and when the event is. It's tested on the most recent past events after training only on the
        ones before them.{model.simulated ? ` ${model.simulated} of the ${model.events} past events are simulated, so treat these numbers as a demonstration until real events replace them.` : ""}
      </p>

      {!model.ready ? <p className="muted mt-4">Not trained yet: it needs at least 60 registrations from finished events.</p> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-5">
          <div className="min-w-0">
            <div className="font-bold mb-2">On {h ? `${h.events} held-out events (${h.examples} registrations)` : "held-out events"}</div>
            {h ? (
              <table className="tbl fc-tbl">
                <thead><tr><th>Measure</th><th>Model</th><th>Without it</th></tr></thead>
                <tbody>
                  <tr><td>Ranking who comes (AUC, higher is better)</td><td className="font-bold">{num(h.auc)}</td><td className="muted">{num(h.aucPastRate)} own past rate only</td></tr>
                  <tr><td>Brier score (lower is better)</td><td className="font-bold">{num(h.brier, 3)}</td><td className="muted">{num(h.brierBase, 3)} average rate</td></tr>
                  <tr><td>Log loss (lower is better)</td><td className="font-bold">{num(h.logLoss, 3)}</td><td className="muted">{num(h.logLossBase, 3)} average rate</td></tr>
                  <tr><td>Headcount off by, per event</td><td className="font-bold">{num(h.headcountError, 1)}</td>
                    <td className="muted">{num(h.headcountErrorBase, 1)} average rate; {num(h.headcountErrorAll, 1)} assuming everyone comes</td></tr>
                </tbody>
              </table>
            ) : <p className="muted text-sm">Needs at least four past events to hold some out.</p>}
            {h && h.calibration && (
              <>
                <div className="font-bold mt-5 mb-1">Calibration</div>
                <p className="text-sm faint mb-2">Of the people it gave a chance in each range, how many actually came.</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {h.calibration.map((c) => (
                    <li key={c.from} className="flex justify-between gap-3">
                      <span className="muted">Predicted {pct(c.from)}–{pct(c.to)} <span className="faint">({c.n})</span></span>
                      <span>avg {pct(c.predicted)} predicted, <strong>{pct(c.actual)}</strong> came</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-bold mb-1">What it learned</div>
            <p className="text-sm faint mb-3">Weight of each fact, on a standardized scale. Right means more likely to come.</p>
            <ul className="flex flex-col gap-2">
              {weights.map((w) => (
                <li key={w.key} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) 140px 44px" }}>
                  <span className="text-sm truncate">{w.label}</span>
                  <span className="relative" style={{ display: "block", height: 10 }}>
                    <span style={{ position: "absolute", display: "block", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--line)" }} />
                    <span style={{ position: "absolute", display: "block", top: 0, height: 10, borderRadius: 3,
                      left: w.weight >= 0 ? "50%" : `${50 - (Math.abs(w.weight) / maxW) * 50}%`,
                      width: `${(Math.abs(w.weight) / maxW) * 50}%`, background: w.weight >= 0 ? "var(--ok)" : "var(--warn)" }} />
                  </span>
                  <span className="text-sm muted text-right flex items-center justify-end gap-1">
                    {w.weight >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{num(w.weight)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

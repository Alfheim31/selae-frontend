import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitLogistic, predictRaw, poissonBinomial, stillComing, arrivedShare, forecastNow, buildExamples, trainTurnout, predictEvent, auc,
} from "./forecast.js";
import { buildSeed } from "./seed.js";

test("logistic regression recovers the direction of each effect", () => {
  let a = 42;
  const r = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
  const X = [], y = [];
  for (let i = 0; i < 3000; i++) {
    const x = [r() * 4 - 2, r() < 0.5 ? 1 : 0, r()];
    const p = 1 / (1 + Math.exp(-(0.3 + 1.2 * x[0] - 0.9 * x[1])));
    X.push(x); y.push(r() < p ? 1 : 0);
  }
  const fit = fitLogistic(X, y);
  assert.ok(fit.w[0] > 0.5, "first feature helps");
  assert.ok(fit.w[1] < -0.2, "second feature hurts");
  assert.ok(Math.abs(fit.w[2]) < 0.15, "third feature is noise");
  assert.ok(predictRaw(fit, [1.5, 0, 0.5]) > predictRaw(fit, [-1.5, 1, 0.5]));
});

test("AUC is 1 for a perfect ranking and 0.5 for a useless one", () => {
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.equal(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]), 0.5);
});

test("the headcount distribution is exact", () => {
  const ps = [0.2, 0.5, 0.9, 0.7];
  const pmf = poissonBinomial(ps);
  assert.ok(Math.abs(pmf.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  const mean = pmf.reduce((s, v, k) => s + v * k, 0);
  assert.ok(Math.abs(mean - ps.reduce((a, b) => a + b, 0)) < 1e-12);
  assert.ok(Math.abs(pmf[4] - 0.2 * 0.5 * 0.9 * 0.7) < 1e-12);
});

test("not having arrived yet lowers the chance someone comes", () => {
  assert.equal(stillComing(0.8, 0), 0.8);
  assert.equal(stillComing(0.8, 1), 0);
  assert.ok(stillComing(0.8, 0.5) < 0.8 && stillComing(0.8, 0.5) > stillComing(0.8, 0.9));
  const q = [-10, 0, 10, 20, 60];
  assert.equal(arrivedShare(q, -20), 0);
  assert.equal(arrivedShare(q, 100), 1);
  assert.equal(arrivedShare(q, 10), 0.5);
});

test("the release recommendation is the most people that stays within the risk", () => {
  const start = new Date(Date.now() + 86400000);
  const regs = [];
  const preds = {};
  for (let i = 0; i < 80; i++) {
    const id = `r${i}`;
    regs.push({ id, status: i < 50 ? "going" : "waitlist", checkin: null, createdAt: new Date(1000 + i).toISOString() });
    preds[id] = { p: 0.6 };
  }
  for (const risk of [0.01, 0.05, 0.1]) {
    const f = forecastNow({ capacity: 50, startsAt: start, endsAt: new Date(start.getTime() + 7200000), regs, preds, arrival: [0, 30], risk });
    assert.ok(f.release > 0, "60% show-up leaves room");
    assert.ok(f.steps[f.release].overflow <= risk);
    if (f.release < 30) assert.ok(f.steps[f.release + 1].overflow > risk);
    assert.ok(f.steps[f.release].empty < f.steps[0].empty);
  }
  const strict = forecastNow({ capacity: 50, startsAt: start, endsAt: new Date(start.getTime() + 7200000), regs, preds, arrival: [0, 30], risk: 0.01 });
  const loose = forecastNow({ capacity: 50, startsAt: start, endsAt: new Date(start.getTime() + 7200000), regs, preds, arrival: [0, 30], risk: 0.1 });
  assert.ok(loose.release > strict.release);
});

test("features for an event only use events before it", () => {
  const now = new Date();
  const data = buildSeed(now);
  const { rows, past } = buildExamples(data, now);
  // In the first past event nobody has any history yet: everyone is a first-timer
  const first = rows.filter((r) => r.eventId === past[0].id);
  assert.ok(first.length > 0);
  assert.ok(first.every((r) => r.x[3] === 1));
  assert.ok(rows.some((r) => r.eventIndex > 0 && r.x[3] === 0));
});

test("the seeded history trains a model that beats the average rate", () => {
  const now = new Date();
  const data = buildSeed(now);
  const model = trainTurnout(data, now);
  assert.ok(model.ready);
  assert.ok(model.holdout.auc > 0.6);
  assert.ok(model.holdout.brier < model.holdout.brierBase);
  const ws = data.events.find((e) => e.id === "ml-workshop");
  const preds = predictEvent(model, data, ws);
  const regs = data.registrations.filter((r) => r.eventId === ws.id);
  assert.equal(Object.keys(preds).length, regs.length);
  const f = forecastNow({ capacity: ws.capacity, startsAt: ws.startsAt, endsAt: ws.endsAt, regs, preds, arrival: model.arrival, now });
  assert.ok(f.release > 0 && f.release < regs.filter((r) => r.status === "waitlist").length);
});

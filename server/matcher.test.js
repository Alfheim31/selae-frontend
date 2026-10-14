import { test } from "node:test";
import assert from "node:assert/strict";
import { rank, learn, emptyModel, channel, PRIOR_WEIGHT, bestAlignment, digitAccuracy } from "./matcher.js";

const going = (id) => ({ id, weight: PRIOR_WEIGHT.expected });
const people = [
  going("2023-41587"), going("2023-41537"), going("2024-10234"), going("2022-77801"),
  { id: "2023-55555", weight: PRIOR_WEIGHT.inside },
  { id: "2021-12345", weight: PRIOR_WEIGHT.stranger },
];

test("an exact read is identified automatically", () => {
  const out = rank(people, "2024-10234", null, emptyModel());
  assert.equal(out.decision, "auto");
  assert.equal(out.top.id, "2024-10234");
});

test("a common OCR confusion still finds the right person", () => {
  // 2022-77801 read with 7 -> 1
  const out = rank(people, "2022-71801", null, emptyModel());
  assert.equal(out.top.id, "2022-77801");
  assert.ok(out.top.p > 0.9);
});

test("two near-identical numbers with an unsure digit go to the operator", () => {
  // 41587 vs 41537 differ only in the digit OCR wasn't sure about, and it read a 5,
  // which OCR confuses with both 8 and 3
  const conf = [0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.3, 0.95];
  const out = rank(people, "2023-41557", conf, emptyModel());
  assert.equal(out.decision, "confirm");
  const ids = out.candidates.slice(0, 2).map((c) => c.id).sort();
  assert.deepEqual(ids, ["2023-41537", "2023-41587"]);
});

test("a read that looks like nobody on file is rejected", () => {
  const out = rank(people, "2019-90909", null, emptyModel());
  assert.equal(out.decision, "reject");
  assert.ok(out.pUnknown > out.top.p);
});

test("the prior prefers guests who haven't arrived over ones already inside", () => {
  // Equally far from 2023-55555 (inside) and 2023-55565 (expected)
  const pool = [{ id: "2023-55555", weight: PRIOR_WEIGHT.inside }, going("2023-55575")];
  const out = rank(pool, "2023-55565", null, emptyModel());
  assert.equal(out.top.id, "2023-55575");
});

test("posteriors sum to one with the unknown hypothesis", () => {
  const out = rank(people, "2023-41587", null, emptyModel(), { limit: people.length });
  const total = out.candidates.reduce((s, c) => s + c.p, 0) + out.pUnknown;
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("alignment handles a dropped digit", () => {
  const { ops } = bestAlignment("202341587", "20234157", channel(null));
  assert.equal(ops.filter((o) => o.kind === "del").length, 1);
});

test("learning from corrections raises the probability of that confusion", () => {
  const model = emptyModel();
  const before = channel(model).P[4][1];
  for (let i = 0; i < 10; i++) learn(model, "2023-11587", "2023-41587"); // 4 read as 1
  const after = channel(model).P[4][1];
  assert.ok(after > before * 3, `P(1|4) ${before} -> ${after}`);
  assert.equal(model.corrections, 10);
});

test("a correction that looks nothing like the read is not learned", () => {
  const model = emptyModel();
  assert.equal(learn(model, "2023-41587", "2019-90909"), null);
  assert.equal(model.corrections, 0);
});

test("after learning, a venue-specific confusion is resolved with more confidence", () => {
  const conf = [0.9, 0.9, 0.9, 0.9, 0.5, 0.9, 0.9, 0.9, 0.9];
  // At this venue 4 keeps getting read as 1, so a "1" should lean toward the 4-version
  const solo = [going("2023-41587"), going("2023-71587")];
  const fresh = rank(solo, "2023-11587", conf, emptyModel());
  const model = emptyModel();
  for (let i = 0; i < 15; i++) learn(model, "2024-11002", "2024-41002");
  const trained = rank(solo, "2023-11587", conf, model);
  const p = (o, id) => o.candidates.find((c) => c.id === id).p;
  assert.ok(p(trained, "2023-41587") > p(fresh, "2023-41587"));
  assert.ok(digitAccuracy(model) > 0);
});

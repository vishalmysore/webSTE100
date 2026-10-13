import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, repairInstructions, splitSentences, countWords } from "../ste-checker.js";

test("counts words and splits sentences", () => {
  assert.equal(countWords("Torque the 3.5 mm bolt to 12 Nm."), 8);
  assert.deepEqual(splitSentences("Remove the cap. Turn the valve, e.g. by hand. Stop."),
    ["Remove the cap.", "Turn the valve, e.g. by hand.", "Stop."]);
});

test("clean STE procedure scores 100", () => {
  const r = lint("WARNING: Do not touch the two clamps together.\n\n1. Park the donor car near the dead car.\n2. Stop the engine of each car.\n3. Attach the red clamp to the positive terminal.");
  assert.equal(r.score, 100);
  assert.equal(r.grade, "STE-ready");
});

test("flags long procedural sentences", () => {
  const r = lint("1. Remove the four screws that hold the cover plate to the frame of the unit and keep them in a safe place for later use.");
  assert.ok(r.units[0].issues.some(i => i.type === "LENGTH"));
});

test("flags multiple instructions in one step", () => {
  const r = lint("1. Open the valve and then remove the cap.");
  assert.ok(r.units[0].issues.some(i => i.type === "MULTI_ACTION"));
});

test("flags passive voice in procedures", () => {
  const r = lint("1. The cap is removed by the operator.");
  assert.ok(r.units[0].issues.some(i => i.type === "PASSIVE" && i.severity === "error"));
});

test("flags complex words and phrases with inflections", () => {
  const r = lint("The tool utilizes a sensor in order to ensure accuracy.");
  const terms = r.units[0].issues.filter(i => i.type === "WORD").map(i => i.suggest);
  assert.ok(terms.includes("use") && terms.includes("to") && terms.includes("make sure"));
});

test("detects synonym drift and picks the most used term", () => {
  const r = lint("Start the engine. Let the engine run. Stop the motor.");
  const d = r.docIssues.find(i => i.type === "DRIFT");
  assert.ok(d);
  assert.equal(d.keep, "engine");
});

test("does not count a short term inside a longer one", () => {
  const r = lint("Remove the inner tube. Inflate the inner tube.");
  assert.equal(r.metrics.drift, 0);
});

test("flags filler without double counting", () => {
  const r = lint("I hope this helps!");
  assert.equal(r.metrics.fluff, 1);
});

test("repair instructions are produced for a chatty answer", () => {
  const r = lint("Great question! Basically, you should utilize the motor and the engine prior to starting.");
  const fixes = repairInstructions(r);
  assert.ok(fixes.some(f => f.includes('Use only')));
  assert.ok(fixes.some(f => f.includes('"utilize"')));
  assert.ok(r.score < 50);
});

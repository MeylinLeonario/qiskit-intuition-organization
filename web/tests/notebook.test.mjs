import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { sanitizeNotebook, notebookMarkdown } from "../src/lib/notebook.js";
import { simulateCircuit, cAbs2 } from "../src/lib/quantum_simulator.js";

test("restores the legacy Streamlit download without losing learner work", () => {
  const legacy = { version: 1, completed_lessons: ["qubit"], tasks_passed: ["flip"], notes: { qubit: "My note" }, reflections: { qubit: "Measurement" }, code_attempts: { flip: "qc.x(0)" }, quiz_answers: { qubit: 2 }, selected_lesson: 4, learning_stage: 3, reading_mode: "plain" };
  const restored = sanitizeNotebook(JSON.parse(JSON.stringify(legacy)));
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(restored[key], value);
  assert.match(notebookMarkdown(restored), /My note/);
  assert.match(notebookMarkdown(restored), /qc.x\(0\)/);
});

test("bounds untrusted notebook data and rejects malformed maps", () => {
  assert.equal(sanitizeNotebook(null).selected_lesson, 0);
  const clean = sanitizeNotebook({ notes: { x: "a".repeat(30000), y: 5 }, selected_lesson: -1, learning_stage: 8, quiz_answers: { x: -1, y: 1.5, z: 2 }, completed_lessons: ["qubit", "qubit", {}] });
  assert.equal(clean.notes.x.length, 20000);
  assert.equal(clean.notes.y, undefined);
  assert.deepEqual(clean.quiz_answers, { z: 2 });
  assert.deepEqual(clean.completed_lessons, ["qubit"]);
  assert.equal(clean.learning_stage, 0);
});

test("all 16 published presets simulate and export, including teleportation CZ", () => {
  const course = JSON.parse(readFileSync(new URL("../src/data/course.json", import.meta.url)));
  assert.equal(course.lessons.length, 16);
  for (const lesson of course.lessons) {
    assert.equal(lesson.code_task.solution, undefined);
    const preset = course.presets[lesson.preset];
    const result = simulateCircuit(preset.qubits, preset.gates);
    assert.ok(Math.abs(result.statevector.reduce((sum, a) => sum + cAbs2(a), 0) - 1) < 1e-8);
  }
  const teleport = simulateCircuit(3, course.presets.Teleportation.gates);
  assert.match(teleport.qiskitCode, /qc.cz\(0, 2\)/);
  assert.ok(Math.abs(teleport.blochAngles[2].z - Math.cos(1.1)) < 1e-8);
});

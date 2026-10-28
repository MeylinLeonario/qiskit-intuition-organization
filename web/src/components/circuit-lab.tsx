"use client";
import { useMemo, useState } from "react";
import { cAbs2, simulateCircuit } from "@/lib/quantum_simulator";
import type { GateName, GateOp } from "@/lib/quantum_simulator";
import { course } from "@/lib/course";
import type { Practice } from "@/lib/course";

export default function CircuitLab({
  preset,
  challenge,
}: {
  preset: string;
  challenge?: Practice;
}) {
  const initial = challenge
    ? { qubits: challenge.qubits, gates: [] }
    : course.presets[preset] || course.presets["Start at |0>"];
  const [gates, setGates] = useState<GateOp[]>(
    initial.gates.map((g, i) => ({
      ...g,
      id: String(i),
      control: g.control ?? undefined,
    })),
  );
  const [gate, setGate] = useState<GateName>("H");
  const [target, setTarget] = useState(0);
  const [control, setControl] = useState(0);
  const [angle, setAngle] = useState(Math.PI / 2);
  const [shots, setShots] = useState(100);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const result = useMemo(
    () => simulateCircuit(initial.qubits, gates),
    [initial.qubits, gates],
  );
  const controlled = gate === "CNOT" || gate === "CZ";
  const sample = () => {
    const histogram: Record<string, number> = {};
    for (let n = 0; n < shots; n++) {
      const draw = Math.random();
      let cumulative = 0;
      for (let i = 0; i < result.statevector.length; i++) {
        cumulative += cAbs2(result.statevector[i]);
        if (draw < cumulative || i === result.statevector.length - 1) {
          const label = i.toString(2).padStart(initial.qubits, "0");
          histogram[label] = (histogram[label] || 0) + 1;
          break;
        }
      }
    }
    setCounts(histogram);
  };
  return (
    <section
      className="panel course-lab"
      aria-label="Interactive circuit experiment"
    >
      <h2>{preset}</h2>
      {challenge && (
        <>
          <p>{challenge.goal}</p>
          <details>
            <summary>Hint</summary>
            <p>{challenge.hint}</p>
          </details>
          <p aria-live="polite">
            {Object.entries(challenge.target).every(
              ([basis, p]) =>
                Math.abs(cAbs2(result.statevector[parseInt(basis, 2)]) - p) <
                0.015,
            ) &&
            (challenge.required || []).every((g) =>
              gates.some((op) => op.gate === g),
            ) &&
            !(challenge.forbidden || []).some((g) =>
              gates.some((op) => op.gate === g),
            )
              ? "Challenge passed!"
              : "Keep experimenting — compare the probabilities and gate requirements with the goal."}
          </p>
        </>
      )}
      <div className="course-controls">
        <label>
          Gate
          <select
            value={gate}
            onChange={(e) => setGate(e.target.value as GateName)}
          >
            {["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CNOT", "CZ"].map(
              (g) => (
                <option key={g}>{g}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Target
          <select
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {Array.from({ length: initial.qubits }, (_, q) => (
              <option key={q} value={q}>
                q{q}
              </option>
            ))}
          </select>
        </label>
        {controlled && (
          <label>
            Control
            <select
              value={control}
              onChange={(e) => setControl(Number(e.target.value))}
            >
              {Array.from({ length: initial.qubits }, (_, q) => (
                <option key={q} value={q}>
                  q{q}
                </option>
              ))}
            </select>
          </label>
        )}
        {["RX", "RY", "RZ"].includes(gate) && (
          <label>
            Angle {angle.toFixed(2)} radians
            <input
              type="range"
              min={-Math.PI * 2}
              max={Math.PI * 2}
              step="0.01"
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
            />
          </label>
        )}
        <button
          className="primary"
          disabled={controlled && control === target}
          onClick={() => {
            setGates([
              ...gates,
              {
                id: crypto.randomUUID(),
                gate,
                target,
                angle,
                ...(controlled ? { control } : {}),
              },
            ]);
            setCounts({});
          }}
        >
          Add gate
        </button>
        <button
          onClick={() => {
            setGates(gates.slice(0, -1));
            setCounts({});
          }}
          disabled={!gates.length}
        >
          Undo
        </button>
        <button
          onClick={() => {
            setGates([]);
            setCounts({});
          }}
        >
          Clear
        </button>
      </div>
      <p aria-live="polite">
        {gates
          .map(
            (g) =>
              `${g.gate}(${g.control === undefined ? "" : `q${g.control} → `}q${g.target})`,
          )
          .join(" → ") || "Initial state |0…0⟩"}
      </p>
      <div className="result-grid">
        <div>
          <h3>Exact probabilities</h3>
          {result.statevector.map((a, i) => (
            <div className="probability-row" key={i}>
              <code>{i.toString(2).padStart(initial.qubits, "0")}</code>
              <div>
                <i style={{ width: `${cAbs2(a) * 100}%` }} />
              </div>
              <span>{(cAbs2(a) * 100).toFixed(1)}%</span>
            </div>
          ))}
          <p>q0 is the rightmost bit.</p>
        </div>
        <div>
          <h3>Bloch vectors</h3>
          {Object.entries(result.blochAngles).map(([q, b]) => (
            <figure key={q}>
              <svg
                width="150"
                height="150"
                viewBox="0 0 150 150"
                role="img"
                aria-label={`Qubit ${q}: x ${b.x.toFixed(2)}, y ${b.y.toFixed(2)}, z ${b.z.toFixed(2)}`}
              >
                <circle
                  cx="75"
                  cy="75"
                  r="55"
                  fill="var(--teal-soft)"
                  stroke="var(--teal)"
                />
                <ellipse
                  cx="75"
                  cy="75"
                  rx="55"
                  ry="15"
                  fill="none"
                  stroke="var(--teal)"
                />
                <path d="M75 20V130M20 75H130" stroke="#96a8ac" />
                <line
                  x1="75"
                  y1="75"
                  x2={75 + b.x * 48 + b.y * 15}
                  y2={75 - b.z * 48 + b.y * 12}
                  stroke="#ad6500"
                  strokeWidth="4"
                />
                <text x="80" y="15">
                  |0⟩
                </text>
                <text x="80" y="145">
                  |1⟩
                </text>
              </svg>
              <figcaption>
                q{q} · {b.purity < 0.98 ? "mixed" : "pure"} · x {b.x.toFixed(2)}
                , y {b.y.toFixed(2)}, z {b.z.toFixed(2)}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div className="course-controls">
        <label>
          Shots
          <input
            type="number"
            min="1"
            max="10000"
            value={shots}
            onChange={(e) =>
              setShots(
                Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
        <button onClick={sample}>Sample measurements</button>
      </div>
      <pre aria-live="polite">
        {Object.entries(counts)
          .map(([basis, count]) => `${basis}: ${count}`)
          .join("\n")}
      </pre>
      <details>
        <summary>Matching Qiskit code</summary>
        <pre>{result.qiskitCode}</pre>
      </details>
    </section>
  );
}

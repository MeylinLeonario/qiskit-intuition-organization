"use client";
import { useState } from "react";
import { cAbs2, simulateCircuit } from "@/lib/quantum_simulator";
import type { GateOp } from "@/lib/quantum_simulator";
import { api } from "@/services/api";
import CircuitLab from "./circuit-lab";

function Slider({
  label,
  value,
  set,
  max = Math.PI * 2,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  max?: number;
}) {
  return (
    <label>
      {label}: {value.toFixed(2)}
      <input
        type="range"
        min="0"
        max={max}
        step="0.01"
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
}
function Bars({ probabilities }: { probabilities: number[] }) {
  const width = Math.log2(probabilities.length);
  return (
    <div>
      {probabilities.map((p, i) => (
        <div className="probability-row" key={i}>
          <code>{i.toString(2).padStart(width, "0")}</code>
          <div>
            <i style={{ width: `${p * 100}%` }} />
          </div>
          <span>{(p * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
const op = (
  gate: GateOp["gate"],
  target: number,
  angle?: number,
  control?: number,
): GateOp => ({ id: `${gate}-${target}`, gate, target, angle, control });

export default function IntuitionWidget({
  widget,
  preset,
}: {
  widget: { type: string; theta?: number; phi?: number; caption?: string };
  preset: string;
}) {
  const [theta, setTheta] = useState(widget.theta ?? 0.3);
  const [phi, setPhi] = useState(widget.phi ?? 0);
  const [basis, setBasis] = useState("Z");
  const [enabled, setEnabled] = useState(true);
  const [steps, setSteps] = useState(0);
  const [marked, setMarked] = useState(3);
  const [target, setTarget] = useState(0.8);
  const [noise, setNoise] = useState(0.1);
  const [counts, setCounts] = useState<number[]>([]);
  const [samples, setSamples] = useState(100);
  const [oracle, setOracle] = useState("x");
  const [route, setRoute] = useState("far");
  const [topology, setTopology] = useState("line");
  const [routing, setRouting] = useState("");
  const type = widget.type;
  if (type === "gate_play") return <CircuitLab preset={preset} />;
  const state = simulateCircuit(1, [op("RY", 0, theta), op("RZ", 0, phi)]);
  let probabilities = state.statevector.map(cAbs2);
  const bloch = state.blochAngles[0];
  if (type === "interference")
    probabilities = simulateCircuit(1, [
      op("H", 0),
      op("RZ", 0, phi),
      op("H", 0),
    ]).statevector.map(cAbs2);
  if (type === "basis_measure")
    probabilities = simulateCircuit(1, [
      op("RY", 0, theta),
      op("RZ", 0, phi),
      ...(basis === "X"
        ? [op("H", 0)]
        : basis === "Y"
          ? [op("S", 0), op("S", 0), op("S", 0), op("H", 0)]
          : []),
    ]).statevector.map(cAbs2);
  if (type === "bit_order")
    probabilities = Array.from({ length: 8 }, (_, i) => (i === marked ? 1 : 0));
  if (type === "entangle")
    probabilities = simulateCircuit(2, [
      op("RY", 0, theta),
      ...(enabled ? [op("CNOT", 1, undefined, 0)] : []),
    ]).statevector.map(cAbs2);
  if (type === "deutsch")
    probabilities = simulateCircuit(2, [
      op("X", 1),
      op("H", 0),
      op("H", 1),
      ...(oracle === "1" || oracle === "not-x" ? [op("X", 1)] : []),
      ...(oracle === "x" || oracle === "not-x"
        ? [op("CNOT", 1, undefined, 0)]
        : []),
      op("H", 0),
    ]).statevector.map(cAbs2);
  if (type === "grover") {
    let amplitudes = [0.5, 0.5, 0.5, 0.5];
    for (let round = 0; round < steps; round++) {
      amplitudes[marked] *= -1;
      const mean = amplitudes.reduce((a, b) => a + b) / 4;
      amplitudes = amplitudes.map((a) => 2 * mean - a);
    }
    probabilities = amplitudes.map((a) => a * a);
  }
  if (type === "noise")
    probabilities = [0.5, 0, 0, 0.5].map((p) => (1 - noise) * p + noise / 4);
  if (type === "variational")
    probabilities = [Math.cos(theta / 2) ** 2, Math.sin(theta / 2) ** 2];
  const teleportGates = [
    op("RY", 0, theta),
    op("H", 1),
    op("CNOT", 2, undefined, 1),
    op("CNOT", 1, undefined, 0),
    op("H", 0),
    op("CNOT", 2, undefined, 1),
    op("CZ", 2, undefined, 0),
  ];
  const teleported =
    type === "teleport"
      ? simulateCircuit(3, teleportGates.slice(0, steps + 1)).blochAngles[2]
      : null;
  const sample = () => {
    const values = probabilities.map(() => 0);
    for (let n = 0; n < samples; n++) {
      const r = Math.random();
      let c = 0;
      for (let i = 0; i < values.length; i++) {
        c += probabilities[i];
        if (r < c || i === values.length - 1) {
          values[i]++;
          break;
        }
      }
    }
    setCounts(values);
  };
  const train = (n: number) => {
    let value = theta;
    for (let i = 0; i < n; i++) {
      const p1 = Math.sin(value / 2) ** 2;
      const derivative =
        (Math.sin((value + Math.PI / 2) / 2) ** 2 -
          Math.sin((value - Math.PI / 2) / 2) ** 2) /
        2;
      value = Math.max(
        0,
        Math.min(2 * Math.PI, value - 4 * (p1 - target) * derivative),
      );
    }
    setTheta(value);
    setSteps(steps + n);
  };
  return (
    <section className="panel" aria-label={`${type} intuition experiment`}>
      {[
        "bloch_dial",
        "shots",
        "basis_measure",
        "entangle",
        "teleport",
        "variational",
      ].includes(type) && (
        <Slider
          label="Tilt θ (radians)"
          value={theta}
          set={(n) => {
            setTheta(n);
            setCounts([]);
          }}
        />
      )}
      {["bloch_dial", "interference", "basis_measure"].includes(type) && (
        <Slider label="Phase φ (radians)" value={phi} set={setPhi} />
      )}
      {type === "basis_measure" && (
        <label>
          Measurement axis
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            {["X", "Y", "Z"].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      )}
      {type === "entangle" && (
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Apply CNOT after RY
        </label>
      )}
      {type === "bit_order" && (
        <div className="course-controls">
          {[0, 1, 2].map((q) => (
            <label key={q}>
              <input
                type="checkbox"
                checked={Boolean(marked & (1 << q))}
                onChange={() => setMarked(marked ^ (1 << q))}
              />
              Flip q{q}
            </label>
          ))}
          <p>
            q2 q1 q0 = {marked.toString(2).padStart(3, "0")}; decimal index{" "}
            {marked}.
          </p>
        </div>
      )}
      {type === "deutsch" && (
        <label>
          Oracle f(x)
          <select value={oracle} onChange={(e) => setOracle(e.target.value)}>
            {["0", "1", "x", "not-x"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <p>
            Final q0 is{" "}
            {oracle === "0" || oracle === "1" ? "0: constant" : "1: balanced"}.
            The oracle is called once.
          </p>
        </label>
      )}
      {type === "grover" && (
        <div className="course-controls">
          <label>
            Marked item
            <select
              value={marked}
              onChange={(e) => setMarked(Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n.toString(2).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grover rounds
            <input
              type="number"
              min="0"
              max="5"
              value={steps}
              onChange={(e) =>
                setSteps(Math.max(0, Math.min(5, Number(e.target.value))))
              }
            />
          </label>
          <p>
            Each round flips the marked amplitude, then reflects every amplitude
            about their mean. Too many rounds overshoot.
          </p>
        </div>
      )}
      {type === "noise" && (
        <>
          <Slider
            label="Depolarizing probability λ"
            value={noise}
            set={setNoise}
            max={1}
          />
          <p>
            ρ′ = (1 − λ)ρ + λI/4. Noise creates {(noise * 50).toFixed(1)}% of
            the outcomes forbidden by an ideal Bell circuit.
          </p>
        </>
      )}
      {type === "variational" && (
        <>
          <Slider label="Target P(1)" value={target} set={setTarget} max={1} />
          <div className="course-controls">
            <button onClick={() => train(1)}>Train 1 step</button>
            <button onClick={() => train(10)}>Train 10 steps</button>
            <button
              onClick={() => {
                setTheta(0.3);
                setSteps(0);
              }}
            >
              Reset
            </button>
          </div>
          <p>
            Parameter-shift gradient descent · {steps} steps · cost{" "}
            {(probabilities[1] - target) ** 2}
          </p>
        </>
      )}
      {type === "teleport" && (
        <>
          <label>
            Protocol step
            <input
              type="range"
              min="0"
              max="6"
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
            />
          </label>
          <p>
            {
              [
                "Prepare the unknown state on q0",
                "Prepare Bell resource: H on q1",
                "Entangle q1 and q2",
                "CNOT from input q0 to q1",
                "H on q0 before measurement",
                "Apply the X correction coherently",
                "Apply the Z correction coherently",
              ][steps]
            }
          </p>
          <p>
            Receiver q2: x {teleported?.x.toFixed(3)}, y{" "}
            {teleported?.y.toFixed(3)}, z {teleported?.z.toFixed(3)}. Input: x{" "}
            {Math.sin(theta).toFixed(3)}, z {Math.cos(theta).toFixed(3)}.
          </p>
          <p>
            This circuit defers measurement and uses coherent corrections. Real
            teleportation measures q0 and q1, sends two classical bits, then
            conditionally corrects q2.
          </p>
        </>
      )}
      {type === "routing" && (
        <>
          <label>
            Circuit
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="near">Bell pair q0 → q1</option>
              <option value="far">CNOT q0 → q3</option>
              <option value="star">Star from q0</option>
            </select>
          </label>
          <label>
            Connectivity
            <select
              value={topology}
              onChange={(e) => setTopology(e.target.value)}
            >
              <option value="line">Line: 0—1—2—3</option>
              <option value="full">All-to-all</option>
            </select>
          </label>
          <button
            onClick={async () => {
              setRouting("Compiling…");
              try {
                const data = await api<{
                  before: string;
                  after: string;
                  cx_before: number;
                  cx_after: number;
                }>("course/routing", { circuit: route, topology });
                setRouting(
                  `Before (${data.cx_before} CX gates)\n${data.before}\nAfter (${data.cx_after} CX gates)\n${data.after}`,
                );
              } catch (error) {
                setRouting(
                  error instanceof Error ? error.message : "Compilation failed",
                );
              }
            }}
          >
            Transpile for chip
          </button>
          <pre aria-live="polite">{routing}</pre>
        </>
      )}
      {!["routing", "teleport"].includes(type) && (
        <Bars probabilities={probabilities} />
      )}
      {type === "bloch_dial" && (
        <>
          <svg
            viewBox="0 0 200 180"
            width="240"
            role="img"
            aria-label={`Bloch vector x ${bloch.x.toFixed(2)}, y ${bloch.y.toFixed(2)}, z ${bloch.z.toFixed(2)}`}
          >
            <circle
              cx="100"
              cy="90"
              r="70"
              fill="var(--teal-soft)"
              stroke="var(--teal)"
            />
            <ellipse
              cx="100"
              cy="90"
              rx="70"
              ry="20"
              fill="none"
              stroke="var(--teal)"
            />
            <line
              x1="100"
              y1="90"
              x2={100 + 60 * bloch.x + 15 * bloch.y}
              y2={90 - 60 * bloch.z + 15 * bloch.y}
              stroke="#ad6500"
              strokeWidth="4"
            />
            <text x="105" y="18">
              |0⟩
            </text>
            <text x="105" y="178">
              |1⟩
            </text>
          </svg>
          <p>
            x {bloch.x.toFixed(2)} · y {bloch.y.toFixed(2)} · z{" "}
            {bloch.z.toFixed(2)}
          </p>
        </>
      )}
      {["shots", "entangle"].includes(type) && (
        <>
          <label>
            Shots
            <input
              type="number"
              min="1"
              max="10000"
              value={samples}
              onChange={(e) =>
                setSamples(
                  Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
                )
              }
            />
          </label>
          <button onClick={sample}>Sample fresh preparations</button>
          <pre aria-live="polite">
            {counts
              .map(
                (n, i) =>
                  `${i.toString(2).padStart(Math.log2(counts.length), "0")}: ${n}`,
              )
              .join("\n")}
          </pre>
        </>
      )}
    </section>
  );
}

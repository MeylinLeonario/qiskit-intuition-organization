"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  CircuitBoard,
  Code2,
  FlaskConical,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "@/components/auth-provider";
import { api } from "@/services/api";
import CircuitLab from "@/components/circuit-lab";
import { course } from "@/lib/course";
import type { GateName, GateOp } from "@/lib/quantum_simulator";
import { cAbs2, simulateCircuit } from "@/lib/quantum_simulator";

type WorkspaceMode = "circuit" | "code";
type ChatMessage = { role: "user" | "assistant"; content: string };

const PRESETS: Record<string, { qubits: number; gates: GateOp[] }> = {
  "Ground state": { qubits: 1, gates: [] },
  Superposition: { qubits: 1, gates: [{ id: "h0", gate: "H", target: 0 }] },
  Interference: {
    qubits: 1,
    gates: [
      { id: "h1", gate: "H", target: 0 },
      { id: "z1", gate: "Z", target: 0 },
      { id: "h2", gate: "H", target: 0 },
    ],
  },
  "Bell state": {
    qubits: 2,
    gates: [
      { id: "bh", gate: "H", target: 0 },
      { id: "bcx", gate: "CNOT", target: 1, control: 0 },
    ],
  },
};

const GATES: GateName[] = [
  "H",
  "X",
  "Y",
  "Z",
  "S",
  "T",
  "RX",
  "RY",
  "RZ",
  "CNOT",
];

function localCoach(question: string, code: string, gates: GateOp[]): string {
  const lower = question.toLowerCase();
  const sequence = gates.map((gate) => gate.gate).join(" → ") || "no gates";
  if (lower.includes("evaluate") || lower.includes("reasoning")) {
    return `Your explanation is grounded in the ${sequence} circuit. Strengthen it by naming the final non-zero basis-state probabilities, then connect those probabilities to the last gate.`;
  }
  if (lower.includes("current circuit") || lower.includes("my circuit")) {
    const entangling =
      gates.some((gate) => gate.gate === "CNOT") &&
      gates.some((gate) => gate.gate === "H");
    return `Your current circuit is ${sequence}. ${entangling ? "H and CNOT can create entanglement. Check their order and the individual Bloch vector lengths to decide what happens in this circuit." : "Predict the basis-state probabilities before adding another operation."}`;
  }
  if (lower.includes("review") || lower.includes("explain my code")) {
    const notes = ["The imports select the circuit and exact-state tools."];
    if (code.includes("QuantumCircuit"))
      notes.push(
        "QuantumCircuit creates the register that gates act on in order.",
      );
    if (code.includes(".h(")) notes.push("H mixes |0⟩ and |1⟩ amplitudes.");
    if (code.includes(".cx("))
      notes.push(
        "CX can entangle the pair when its control is in superposition.",
      );
    if (code.includes("Statevector.from_instruction"))
      notes.push(
        "Statevector evaluates the ideal pre-measurement state exactly.",
      );
    return `${notes.join(" ")} Next: write down the expected probability dictionary, then compare it with the output.`;
  }
  return "Ask me to explain the current circuit, review the Qiskit code, or connect a gate to the resulting amplitudes.";
}

export default function Home() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("circuit");
  const [numQubits, setNumQubits] = useState(2);
  const [gates, setGates] = useState<GateOp[]>(PRESETS["Bell state"].gates);
  const [selectedGate, setSelectedGate] = useState<GateName>("H");
  const [target, setTarget] = useState(0);
  const [control, setControl] = useState(0);
  const [code, setCode] = useState(
    () => simulateCircuit(2, PRESETS["Bell state"].gates).qiskitCode,
  );
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [challenge, setChallenge] = useState(0);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const runCode = async () => {
    setRunning(true);
    try {
      const result = await api<{
        stdout: string;
        stderr: string;
        error?: string;
      }>("execute", { code });
      setOutput(
        [result.stdout, result.stderr, result.error]
          .filter(Boolean)
          .join("\n") || "Finished without output.",
      );
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  };
  const result = useMemo(
    () => simulateCircuit(numQubits, gates),
    [numQubits, gates],
  );
  const loadPreset = (name: string) => {
    const preset = PRESETS[name];
    setNumQubits(preset.qubits);
    setGates(preset.gates.map((gate) => ({ ...gate })));
    setTarget(0);
    setControl(0);
    setCode(simulateCircuit(preset.qubits, preset.gates).qiskitCode);
  };

  const changeQubitCount = (count: number) => {
    setNumQubits(count);
    setGates((current) =>
      current.filter(
        (gate) =>
          gate.target < count &&
          (gate.control === undefined || gate.control < count),
      ),
    );
    setTarget((current) => Math.min(current, count - 1));
    setControl((current) => Math.min(current, count - 1));
  };

  const addGate = () => {
    if (selectedGate === "CNOT" && (numQubits < 2 || target === control))
      return;
    const operation: GateOp = {
      id: `${selectedGate}-${Date.now()}`,
      gate: selectedGate,
      target,
      ...(selectedGate === "CNOT" ? { control } : {}),
      ...(["RX", "RY", "RZ"].includes(selectedGate)
        ? { angle: Math.PI / 2 }
        : {}),
    };
    setGates((current) => [...current, operation]);
  };

  const askCoach = async (prompt = question) => {
    const clean = prompt.trim();
    if (!clean || asking) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: clean }]);
    setAsking(true);
    let reply = "";
    try {
      const data = await api<{ reply: string }>("agent/tutor", {
        message: clean,
        code,
        gates,
        num_qubits: numQubits,
        lesson_title: "Free circuit playground",
      });
      reply = data.reply;
    } catch {
      reply = "";
    }
    if (!reply) reply = localCoach(clean, code, gates);
    setMessages((current) => [
      ...current,
      { role: "assistant", content: reply },
    ]);
    setAsking(false);
  };

  const probabilities = result.statevector
    .map((amplitude, index) => ({
      basis: index.toString(2).padStart(numQubits, "0"),
      probability: cAbs2(amplitude),
    }))
    .filter((item) => item.probability > 0.0001);

  const circuitWorkspace = (guided: boolean) => (
    <>
      {!guided && (
        <div className="preset-row" aria-label="Worked examples">
          {Object.keys(PRESETS).map((name) => (
            <button key={name} onClick={() => loadPreset(name)}>
              <Sparkles size={14} aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="builder-card">
        <div className="field">
          <label>Qubits</label>
          <select
            value={numQubits}
            disabled={guided}
            onChange={(event) => changeQubitCount(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((number) => (
              <option key={number}>{number}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Gate</label>
          <select
            value={selectedGate}
            onChange={(event) =>
              setSelectedGate(event.target.value as GateName)
            }
          >
            {GATES.map((gate) => (
              <option key={gate}>{gate}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Target</label>
          <select
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
          >
            {Array.from({ length: numQubits }, (_, qubit) => (
              <option value={qubit} key={qubit}>
                q{qubit}
              </option>
            ))}
          </select>
        </div>
        {selectedGate === "CNOT" && (
          <div className="field">
            <label>Control</label>
            <select
              value={control}
              onChange={(event) => setControl(Number(event.target.value))}
            >
              {Array.from({ length: numQubits }, (_, qubit) => (
                <option value={qubit} key={qubit}>
                  q{qubit}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="builder-actions">
          <button
            className="primary"
            disabled={
              selectedGate === "CNOT" && (numQubits < 2 || control === target)
            }
            onClick={addGate}
          >
            <Plus size={17} aria-hidden="true" />
            Add gate
          </button>
          <button
            disabled={gates.length === 0}
            onClick={() => setGates([])}
            aria-label="Clear circuit"
          >
            <RotateCcw size={17} aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>
      <div className="circuit-strip" aria-label="Current circuit">
        {gates.length === 0 && (
          <p>No gates yet. The register starts in |0…0⟩.</p>
        )}
        {gates.map((gate, index) => (
          <button
            key={gate.id}
            aria-label={`Remove ${gate.gate} gate ${index + 1}`}
            title="Remove gate"
            onClick={() =>
              setGates((current) =>
                current.filter((item) => item.id !== gate.id),
              )
            }
          >
            <small>{index + 1}</small>
            <strong>{gate.gate}</strong>
            <span>
              {gate.gate === "CNOT"
                ? `q${gate.control} → q${gate.target}`
                : `q${gate.target}`}
            </span>
            <X className="remove-gate" size={13} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="result-grid">
        <article className="panel">
          <h2>Measurement probabilities</h2>
          {probabilities.map((item) => (
            <div className="probability-row" key={item.basis}>
              <code>|{item.basis}⟩</code>
              <div>
                <i style={{ width: `${item.probability * 100}%` }} />
              </div>
              <span>{(item.probability * 100).toFixed(1)}%</span>
            </div>
          ))}
          <p className="caption">Qiskit displays q0 as the rightmost bit.</p>
        </article>
        <article className="panel">
          <h2>Single-qubit readout</h2>
          {Object.entries(result.blochAngles).map(([qubit, value]) => (
            <div className="readout" key={qubit}>
              <strong>q{qubit}</strong>
              <span>{value.purity > 0.98 ? "pure" : "mixed / entangled"}</span>
              <code>
                x {value.x.toFixed(2)} · y {value.y.toFixed(2)} · z{" "}
                {value.z.toFixed(2)}
              </code>
            </div>
          ))}
        </article>
      </div>
      <article className="explanation-card">
        <strong>Interpretation</strong>
        <p>
          {gates.length === 0
            ? "The circuit is empty, so every qubit remains in |0⟩."
            : `The sequence is ${gates.map((gate) => gate.gate).join(" → ")}. ${Object.values(result.blochAngles).some((value) => value.purity < 0.98) ? "The individual qubits are mixed while the joint state is pure: this register is entangled." : "Compare the final bars with the effect you predicted for the last gate."}`}
        </p>
      </article>
      <details className="code-details">
        <summary>State and matching Qiskit code</summary>
        <pre>{result.qiskitCode}</pre>
        <button
          className="primary"
          onClick={() => {
            setCode(result.qiskitCode);
            setWorkspaceMode("code");
          }}
        >
          <Code2 size={17} aria-hidden="true" />
          Open in code workspace
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </details>
    </>
  );

  const codeWorkspace = () => (
    <>
      <div className="code-toolbar">
        <button onClick={() => setCode(result.qiskitCode)}>
          <Code2 size={17} aria-hidden="true" />
          Use current circuit code
        </button>
        <span>Teaching coach with built-in fallback</span>
      </div>
      <textarea
        className="code-editor"
        aria-label="Qiskit code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        spellCheck={false}
      />
      <button className="primary" disabled={running} onClick={runCode}>
        {running ? "Running…" : "Run Qiskit code"}
      </button>
      {output && <pre aria-live="polite">{output}</pre>}
      <div className="quick-prompts">
        {[
          "Explain my code",
          "Review my code",
          "Explain my current circuit",
          "Give me a next exercise",
        ].map((prompt) => (
          <button key={prompt} onClick={() => askCoach(prompt)}>
            <Sparkles size={14} aria-hidden="true" />
            {prompt}
          </button>
        ))}
      </div>
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && (
          <p className="empty-chat">
            The coach receives this code, the current circuit, and the selected
            lesson.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`message ${message.role}`}
          >
            <small>{message.role === "user" ? "You" : "Coach"}</small>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <div className="prompt-row">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") askCoach();
          }}
          placeholder="Ask about the code, circuit, or lesson"
        />
        <button
          className="primary"
          disabled={!question.trim() || asking}
          onClick={() => askCoach()}
        >
          {asking ? (
            "Reviewing…"
          ) : (
            <>
              <Send size={16} aria-hidden="true" />
              Ask coach
            </>
          )}
        </button>
      </div>
    </>
  );

  return (
    <div className="site-shell">
      <aside className="site-sidebar">
        <div className="site-brand">
          <span className="brand-mark">Q</span>
          <strong>Qiskit Intuition</strong>
        </div>
        <AccountMenu />
        <nav aria-label="Primary navigation">
          <Link href="/">Learning path · 16 lessons</Link>
          <Link href="/playground">Playground & code coach</Link>
        </nav>
      </aside>
      <main className="site-main">
        <p className="eyebrow">Explore freely</p>
        <h1>Playground</h1>
        <p className="lede">
          Build circuits, run Qiskit code and ask the coach about your
          experiment.
        </p>
        <div className="workspace-switch" aria-label="Workspace view">
          <button
            className={workspaceMode === "circuit" ? "active" : ""}
            onClick={() => setWorkspaceMode("circuit")}
          >
            Circuit builder
          </button>
          <button
            className={workspaceMode === "code" ? "active" : ""}
            onClick={() => setWorkspaceMode("code")}
          >
            Qiskit code
          </button>
        </div>
        {workspaceMode === "circuit"
          ? circuitWorkspace(false)
          : codeWorkspace()}
        <section className="panel">
          <h2>Practice challenges</h2>
          <label>
            Challenge
            <select
              value={challenge}
              onChange={(e) => setChallenge(Number(e.target.value))}
            >
              {course.practice.map((p, i) => (
                <option key={p.title} value={i}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <CircuitLab
            key={challenge}
            preset={course.practice[challenge].title}
            challenge={course.practice[challenge]}
          />
        </section>
      </main>
    </div>
  );
}

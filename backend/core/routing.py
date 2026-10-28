"""Hardware routing visualization without a Streamlit dependency."""
from backend.core.qiskit_thread import on_qiskit_thread

ROUTING_CIRCUITS = {
    "Bell pair on neighbours (q0, q1)": [("h", 0), ("cx", 0, 1)],
    "CNOT between far-apart qubits (q0 → q3)": [("h", 0), ("cx", 0, 3)],
    "Star: q0 talks to everyone": [("h", 0), ("cx", 0, 1), ("cx", 0, 2), ("cx", 0, 3)],
}


@on_qiskit_thread
def route_circuit(circuit_name: str, topology: str) -> dict:
    from qiskit import QuantumCircuit, transpile
    from qiskit.transpiler import CouplingMap

    qc = QuantumCircuit(4)
    for op in ROUTING_CIRCUITS[circuit_name]:
        getattr(qc, op[0])(*op[1:])
    coupling = CouplingMap.from_line(4) if topology.startswith("Line") else CouplingMap.from_full(4)
    native = transpile(
        qc, coupling_map=coupling, basis_gates=["rz", "sx", "x", "cx"],
        initial_layout=[0, 1, 2, 3], optimization_level=1, seed_transpiler=7,
    )
    ops = dict(native.count_ops())
    return {
        "before": qc.draw(output="text", fold=-1).single_string(),
        "after": native.draw(output="text", fold=-1, idle_wires=False).single_string(),
        "cx_before": dict(qc.count_ops()).get("cx", 0),
        "cx_after": ops.get("cx", 0),
        "depth_before": qc.depth(),
        "depth_after": native.depth(),
    }


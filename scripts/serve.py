"""Supervise the Node UI and the private Python Qiskit service in one container."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
processes = []


def stop(signum=None, frame=None):
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    try:
        processes.append(subprocess.Popen([
            sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000",
        ], cwd=ROOT))
        processes.append(subprocess.Popen(["node", "server.js"], cwd=ROOT / "web", env={
            **os.environ, "HOSTNAME": "0.0.0.0", "PORT": os.environ.get("PORT", "7860"),
        }))
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
        return next((process.returncode for process in processes if process.returncode), 1)
    finally:
        stop()


if __name__ == "__main__":
    sys.exit(main())

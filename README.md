---
title: Qiskit Intuition
emoji: ⚛️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Qiskit Intuition

**Learn quantum computing and Qiskit from zero, intuition first, in a paper lab notebook.**

**▶ Try it:** [huggingface.co/spaces/j76dvyt4q5-cyber/Qiskit-Intuition](https://huggingface.co/spaces/j76dvyt4q5-cyber/Qiskit-Intuition). It works on laptops, tablets and phones, with no sign-up or API key.

Most quantum courses open with linear algebra. This one opens with a picture you can grab and turn. Each idea becomes a prediction you test, then an experiment, and only then the math and the Qiskit code.

## How every lesson works

| Step | What you do |
| --- | --- |
| 1. **Intuition** | Play with an interactive picture: an adjustable Bloch vector, a shot sampler, interference phasors, an entanglement sampler, a Grover amplifier, live transpiler routing and more. |
| 2. **Predict** | Commit to an answer. Every option, right or wrong, explains why it is tempting. |
| 3. **Experiment** | Build the circuit in a guided builder and watch each qubit's Bloch sphere. |
| 4. **Formalize** | Learn the math, now that the picture exists. |
| 5. **Code it** | Read the Qiskit API line by line, then solve an exercise that is checked automatically. |
| 6. **Reflect** | Explain the result in your own words and get instant feedback on what you covered and what you missed. |

## Curriculum

| Unit | Lessons |
| --- | --- |
| One qubit | Why quantum computers? · What is a qubit? · Flipping with X · Measurement and shots · Superposition with H · Rotations · Phase · Interference · Measuring in other directions |
| Many qubits | Many qubits and bit order · Entanglement · Why you can't copy a qubit · Teleportation · Superdense coding |
| Algorithms | Phase kickback: Deutsch's algorithm · A secret string in one question (Bernstein–Vazirani) · Grover search · The quantum Fourier transform · Phase estimation |
| Real hardware & beyond | Noise and transpilation · Running on a real chip · Trainable circuits and quantum ML |

Every lesson opens with an everyday analogy — what it captures and where it breaks — and ends with a one-line "remember it as" takeaway.

## Features

- **A notebook that remembers.** Signed-in progress, predictions, margin notes, explanations and exercise code save automatically to your account in SQLite/Turso and return on another device. Guests keep a browser-only notebook. Account notebooks also keep a local backup for interrupted connections. **My notebook** collects everything you wrote; download it as JSON to restore later, or as a Markdown write-up.
- **Auto-checked Qiskit exercises.** Your code runs in a sandbox: an import allowlist plus an isolated process with time and memory limits. Its circuit is compared with a reference solution by state fidelity or by measurement distribution.
- **Instant feedback on explanations.** "Check my reasoning" compares what you wrote with each lesson's key ideas and common misconceptions. It works offline. With `GEMINI_API_KEY` set, an AI model adds notes.
- **Playground.** A free circuit builder and Qiskit code runner with a code coach, plus practice challenges. Nothing there affects course progress.
- **Glossary.** Every term with its picture and its precise definition.
- **Built for every screen.** On phones the sidebar tucks away and page tabs take its place, and the experiment controls work with touch.
- **Easy to read.** A sidebar switch increases text size and line spacing. Colours meet WCAG AA contrast.
- **Feedback button on every page.** Testers can report what confused them, what broke or what they liked. opens a pre-filled GitHub issue with the page, lesson and step.
- **Content Studio.** Course authors can edit every part of a lesson in plain text: intuition, widget, quiz, worked circuit, math, Qiskit example, exercise and reflection rubric. To open it, go to the sidebar → **Course author**. Preview validates the JSON lesson structure; Qiskit examples and exercises can be checked in the course.

## Run locally

The frontend runs on **Node.js 22+ / Next.js**. Python 3.11+ serves the Qiskit
sandbox and exercise checker behind a same-origin Node API proxy.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
cd web
npm ci
npm run dev
```

Open http://localhost:3000. The learning path, simulator, notebook and glossary
work without the Python service; executing Qiskit and checking exercises or
reflections require it. Set `NEXT_PUBLIC_API_URL` in `web/.env.local` when Python runs
elsewhere (default: `http://127.0.0.1:8000`). This is the public backend origin, not a secret.

Production: `cd web && npm run build && npm start`, alongside the Python service.
The root Dockerfile packages both processes and exposes the Node frontend on
port 7860 (`docker build -t qiskit-intuition .` then
`docker run --rm -p 7860:7860 qiskit-intuition`).

## Accounts

JWT sign-up/login, a profile with a picture and password changes, and email
password recovery are documented in [Authentication](docs/authentication.md).
Local development uses SQLite through SQLAlchemy; Vercel uses hosted SQLite
(Turso), with Resend for password-reset email.

Learn about automatic saves, guest import and simultaneous edits in
[Notebook synchronization](docs/notebook-sync.md).

## Configuration

Everything is optional. On Hugging Face, add these as **Space secrets**. Locally, put them in a `.env` file.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Adds AI notes to the Reflect feedback and the code coach. Without it, the built-in feedback and coach still work. |
| `GEMINI_MODEL` | Overrides the default Gemini model name. |
| `FEEDBACK_GITHUB_TOKEN` | A fine-grained GitHub token with **Issues: write** on this repository. It lets the feedback button file issues directly. Without it, testers get a pre-filled issue link to submit themselves. |
| `FEEDBACK_GITHUB_REPO` | Where feedback goes (`owner/name`). Defaults to this repository. |
| `ALLOWED_ORIGINS` | Extra CORS origins for the optional FastAPI service, comma-separated. |

## Deployment

Every push to `main` runs CI. It also uploads the app to the Hugging Face Space through `.github/workflows/sync-to-huggingface.yml`, which needs an `HF_TOKEN` repository secret with write access to the Space. The Space uses the Docker SDK and the root Dockerfile to start the Node frontend and private Python service.

### Separate Vercel deployments

For the frontend project, use **Root Directory: `web`**, the Next.js preset and
Node.js 22+. Set `NEXT_PUBLIC_API_URL` to the Python deployment's HTTPS
origin, then redeploy the frontend. This URL is public and contains no credentials.
Do not point it at the frontend itself; `127.0.0.1` only works when both services
run together locally or in the Docker image.

For the backend project, use the **repository root** and the FastAPI preset.
`app.py` exports the FastAPI application; it does not import Streamlit.
Runtime dependencies are declared in `pyproject.toml` for Vercel/uv and in
`requirements.txt` for pip/Docker. `uv.lock` fixes the versions used by uv.
Keep both lists in sync and run `uv lock` when adding a dependency.
If an old deployment reports `ModuleNotFoundError: dotenv`, deploy this manifest
change and redeploy the backend without the existing build cache.
Deploy the same branch to both projects so the `/course/routing` endpoint exists
on the Python deployment too. Verify `/health` on the backend first, then
`/api/health` on the frontend. If Vercel returns a platform 500, inspect the
backend function logs for its Python startup error; the UI now handles a
non-JSON platform response without a JSON parsing exception.

## Editing course content

Changes made in the Content Studio apply to your session straight away. To publish them for everyone:

1. Download `site_content.json` from the Content Studio.
2. Replace `frontend/site_content.json` with it.
3. Run `python scripts/export_course.py` to regenerate the bundled web curriculum.
4. Commit both files and push. CI checks that the export is current; the Space redeploys automatically.

Visitors can't change the live course. See [CONTRIBUTING.md](CONTRIBUTING.md) for the lesson format and how to write lessons directly in Python.

## Tests

```bash
pip install -r requirements-dev.txt
python scripts/export_course.py --check
ruff check .
pytest tests -q
cd web && npm test && npm run lint && npm run build
```

The tests check the quantum engine, the sandbox (including escape attempts), the exercise checker, the explanation reviewer, Content Studio parsing, notebook save and restore, and feedback filing. They also cover the curriculum: every worked example must run, and every exercise's reference solution must pass while its starter code fails. A smoke test clicks through every stage of every lesson. CI runs everything on each push and pull request.

## Known limits

- Guest progress is stored per browser. Sign in to sync it across devices; use **Import browser notebook** to bring guest work into your account. Unsynced offline work needs the browser backup until connectivity returns.
- On the free Hugging Face tier, the Space sleeps when idle, so the first visit afterwards can take about 30 seconds.
- Circuits run on a simulator. The hardware lessons simulate a real chip's layout and noise instead of sending jobs to IBM Quantum.

## Project structure

```text
Dockerfile, scripts/serve.py          Node frontend + private Python API deployment
app.py                               ASGI backend entry point for Vercel
frontend/streamlit_app.py            The learning app: pages, lesson steps, Content Studio
frontend/learning_content.py         Curriculum, rubrics, presets, practice, glossary
frontend/intuition.py                Interactive intuition widgets and SVG visuals
frontend/bloch3d.py                  Draggable 3D Bloch sphere (runs in the browser)
frontend/lesson_editing.py           Plain-text lesson formats for the Content Studio
frontend/notebook_store.py           Save/restore the learner's notebook
frontend/notebook_storage/           Tiny HTML component that talks to localStorage
frontend/education_theme.py          The paper-notebook look
frontend/site_content.json           Published content overrides
static/fonts/                        Self-hosted fonts (SIL Open Font License)
backend/core/quantum_engine.py       Qiskit simulation, noise and export
backend/core/notebook_engine.py      Code sandbox (allowlist + isolated process)
backend/core/exercise_checker.py     Auto-checks learner code against a reference
backend/core/explanation_review.py   Instant feedback on written explanations
backend/core/feedback.py             Files tester feedback as GitHub issues
backend/core/qiskit_thread.py        Runs in-app Qiskit work on one thread
backend/core/teaching_assistant.py   Code review and tutoring
backend/main.py, backend/routers/    Optional FastAPI service (simulation, execution, tutor)
web/                                 Primary Node.js / Next.js frontend
backend/routers/course.py            Exercise checking, reflection and course API
scripts/export_course.py             Shared curriculum → bundled web JSON
tests/                               Python tests
```

The legacy Streamlit source remains temporarily for regression tests. Install `requirements-dev.txt` to run those tests; Streamlit is excluded from the production runtime.

The web migration retains all lessons (22 now), six stages, quizzes, circuit experiments, Qiskit examples and exercises, reflections, glossary, notebook JSON/Markdown export, and a session-only JSON Content Studio. Legacy notebooks can be imported from their JSON downloads. Intuition widgets run in the browser: angle and phase dials, gate experiments, shot sampling, basis changes, bit order, entanglement, teleportation, Deutsch, Grover, depolarizing noise and parameter-shift training. Hardware routing uses Qiskit through the API. Bloch diagrams use a projected vector and angle controls in place of the old draggable 3D renderer. The notebook theme uses the original cream ruled paper, red margin, punched binding and self-hosted handwriting fonts. Easy reading switches to Atkinson Hyperlegible. The author form is a JSON content editor.

## Licence

MIT. See [LICENSE](LICENSE). The fonts in `static/fonts/` are under the SIL Open Font License.

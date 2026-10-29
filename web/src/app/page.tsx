"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "@/components/auth-provider";
import CircuitLab from "@/components/circuit-lab";
import IntuitionWidget from "@/components/intuition-widget";
import { course, parseContent } from "@/lib/course";
import type { Lesson } from "@/lib/course";
import { notebookMarkdown, sanitizeNotebook } from "@/lib/notebook";
import type { Notebook } from "@/lib/notebook";
import {
  useNotebook,
  NotebookSyncNotice,
} from "@/components/notebook-provider";
import { api } from "@/services/api";

const STAGES = [
  "Intuition",
  "Predict",
  "Experiment",
  "Formalize",
  "Code it",
  "Reflect",
];
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
function Paragraphs({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <p key={i}>
          {line
            .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
            .map((part, j) =>
              part.startsWith("**") ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : part.startsWith("`") ? (
                <code key={j}>{part.slice(1, -1)}</code>
              ) : (
                part
              ),
            )}
        </p>
      ))}
    </>
  );
}
type Feedback = {
  message?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  markdown?: string;
  passed?: boolean;
  figures?: string[];
};

export default function Home() {
  const [lessons, setLessons] = useState<Lesson[]>(course.lessons);
  const [brand, setBrand] = useState(course.brand);
  const { notebook, setNotebook, ready, owner } = useNotebook();
  const activeOwner = useRef(owner);
  activeOwner.current = owner;
  const [view, setView] = useState("course");
  const [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState("");
  const index = Math.min(notebook.selected_lesson, lessons.length - 1);
  const lesson = lessons[index];
  const stage = notebook.learning_stage;
  const answer = notebook.quiz_answers[lesson.id];
  const code = notebook.code_attempts[lesson.id] ?? lesson.code_task.starter;

  useEffect(() => {
    setFeedback({});
    setNotice("");
    setBusy(false);
  }, [owner]);

  const patch = (update: Partial<Notebook>) =>
    setNotebook((current) => ({ ...current, ...update }));
  const text = (
    field: "notes" | "reflections" | "code_attempts",
    value: string,
  ) =>
    setNotebook((current) => ({
      ...current,
      [field]: { ...current[field], [lesson.id]: value },
    }));
  const move = (next: number) => {
    patch({
      learning_stage: next,
      lesson_max_stage: {
        ...notebook.lesson_max_stage,
        [lesson.id]: Math.max(next, notebook.lesson_max_stage[lesson.id] || 0),
      },
    });
    setFeedback({});
  };
  const open = (next: number) => {
    patch({ selected_lesson: next, learning_stage: 0 });
    setFeedback({});
    setView("course");
  };
  const request = async (operation: string, body: unknown) => {
    setBusy(true);
    setFeedback({});
    try {
      const data = await api<Feedback>(operation, body);
      if (activeOwner.current !== owner) return;
      setFeedback(data);
      if (data.passed)
        setNotebook((current) => ({
          ...current,
          tasks_passed: Array.from(
            new Set([...current.tasks_passed, lesson.id]),
          ),
        }));
    } catch (error) {
      if (activeOwner.current !== owner) return;
      setFeedback({
        error: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      if (activeOwner.current === owner) setBusy(false);
    }
  };
  const feedbackLink = `https://github.com/MeylinLeonario/qiskit-intuition-organization/issues/new?${new URLSearchParams({ title: `[Feedback] ${lesson.title}`, body: `Page: ${view}\nLesson: ${lesson.title}\nStage: ${STAGES[stage]}\n\nWhat happened?\n` })}`;

  if (!ready)
    return <main className="course-loading">Opening your notebook…</main>;
  return (
    <div
      className={`site-shell ${notebook.reading_mode === "plain" ? "plain-reading" : ""}`}
    >
      <aside className="site-sidebar">
        <div className="site-brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>{brand.name}</strong>
            <small>{brand.tagline}</small>
          </div>
        </div>
        <AccountMenu />
        <nav aria-label="Primary navigation">
          {[
            ["course", "Learning path"],
            ["notebook", "My notebook"],
            ["glossary", "Glossary"],
            ["author", "Content Studio"],
          ].map(([id, title]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {title}
            </button>
          ))}
          <Link href="/playground">Playground & code coach</Link>
        </nav>
        <label className="sidebar-lesson">
          Current lesson
          <select value={index} onChange={(e) => open(Number(e.target.value))}>
            {lessons.map((item, i) => (
              <option key={item.id} value={i}>
                {i + 1}. {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="sidebar-progress">
          <span>Course progress</span>
          <progress
            value={
              notebook.completed_lessons.filter((id) =>
                lessons.some((l) => l.id === id),
              ).length
            }
            max={lessons.length}
          />
          <small>
            {
              notebook.completed_lessons.filter((id) =>
                lessons.some((l) => l.id === id),
              ).length
            }{" "}
            of {lessons.length} lessons completed
          </small>
        </div>
        <label>
          <input
            type="checkbox"
            checked={notebook.reading_mode === "plain"}
            onChange={(e) =>
              patch({ reading_mode: e.target.checked ? "plain" : "notebook" })
            }
          />{" "}
          Easy reading
        </label>
        <a href={feedbackLink} target="_blank" rel="noreferrer">
          Report feedback
        </a>
      </aside>
      <main className="course-main">
        <NotebookSyncNotice />
        {notice && (
          <p role="status" className="explanation-card">
            {notice}
          </p>
        )}
        {view === "course" && (
          <>
            <header>
              <p className="eyebrow">
                Lesson {index + 1} · {lesson.duration}
              </p>
              <h1>{lesson.title}</h1>
              <p>{lesson.summary}</p>
            </header>
            <nav className="course-stages" aria-label="Lesson stages">
              {STAGES.map((name, i) => (
                <button
                  key={name}
                  aria-current={stage === i ? "step" : undefined}
                  className={stage === i ? "primary" : ""}
                  onClick={() => move(i)}
                >
                  {i + 1}. {name}
                </button>
              ))}
            </nav>
            <article className="panel course-lesson">
              <h2>{STAGES[stage]}</h2>
              {stage === 0 && (
                <>
                  <Paragraphs lines={lesson.intuition} />
                  <ul>
                    {lesson.objectives.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <p>{lesson.widget.caption}</p>
                  <IntuitionWidget
                    key={`${lesson.id}-intuition`}
                    widget={lesson.widget}
                    preset={lesson.preset}
                  />
                </>
              )}
              {stage === 1 &&
                (lesson.quiz ? (
                  <>
                    <h3>{lesson.quiz.question}</h3>
                    <fieldset className="course-quiz">
                      <legend>Your prediction</legend>
                      {lesson.quiz.options.map((option, i) => (
                        <label key={i}>
                          <input
                            type="radio"
                            name={`prediction-${lesson.id}`}
                            checked={answer === i}
                            onChange={() =>
                              patch({
                                quiz_answers: {
                                  ...notebook.quiz_answers,
                                  [lesson.id]: i,
                                },
                              })
                            }
                          />
                          {option}
                        </label>
                      ))}
                    </fieldset>
                    {answer !== undefined && (
                      <p role="status" className="explanation-card">
                        {answer === lesson.quiz.answer
                          ? "Correct. "
                          : "Try again. "}
                        {lesson.quiz.explanations[answer]}
                      </p>
                    )}
                  </>
                ) : (
                  <p>{lesson.checkpoint}</p>
                ))}
              {stage === 2 && (
                <>
                  <Paragraphs lines={lesson.try_this} />
                  <CircuitLab
                    key={`${lesson.id}-experiment`}
                    preset={lesson.preset}
                  />
                </>
              )}
              {stage === 3 && (
                <>
                  <Paragraphs lines={lesson.explanation} />
                  <pre>{lesson.equation}</pre>
                  <p className="explanation-card">{lesson.misconception}</p>
                </>
              )}
              {stage === 4 && (
                <>
                  <p>{lesson.qiskit.intro}</p>
                  <pre>{lesson.qiskit.code}</pre>
                  <button
                    disabled={busy}
                    onClick={() =>
                      request("execute", { code: lesson.qiskit.code })
                    }
                  >
                    Run worked example
                  </button>
                  <dl>
                    {lesson.qiskit.notes.map(([term, note], i) => (
                      <div key={i}>
                        <dt>
                          <code>{term}</code>
                        </dt>
                        <dd>{note}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3>Your exercise</h3>
                  <p>{lesson.code_task.prompt}</p>
                  <textarea
                    className="code-editor"
                    aria-label="Exercise code"
                    value={code}
                    maxLength={20000}
                    spellCheck={false}
                    onChange={(e) => text("code_attempts", e.target.value)}
                  />
                  <div className="course-controls">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        request("course/exercise", {
                          lesson_id: lesson.id,
                          code,
                        })
                      }
                    >
                      Check exercise
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => request("execute", { code })}
                    >
                      Run code
                    </button>
                    <button
                      onClick={() =>
                        text("code_attempts", lesson.code_task.starter)
                      }
                    >
                      Reset starter
                    </button>
                  </div>
                  <details>
                    <summary>Hint</summary>
                    <p>{lesson.code_task.hint}</p>
                  </details>
                  {notebook.tasks_passed.includes(lesson.id) && (
                    <p>Exercise passed.</p>
                  )}
                </>
              )}
              {stage === 5 && (
                <>
                  <h3>{lesson.checkpoint}</h3>
                  <textarea
                    aria-label="Your reflection"
                    rows={7}
                    maxLength={20000}
                    value={notebook.reflections[lesson.id] || ""}
                    onChange={(e) => text("reflections", e.target.value)}
                  />
                  <div className="course-controls">
                    <button
                      disabled={
                        busy || !notebook.reflections[lesson.id]?.trim()
                      }
                      onClick={() =>
                        request("course/reflect", {
                          lesson_id: lesson.id,
                          text: notebook.reflections[lesson.id],
                        })
                      }
                    >
                      Check my reasoning
                    </button>
                    <button
                      className="primary"
                      disabled={!notebook.reflections[lesson.id]?.trim()}
                      onClick={() => {
                        patch({
                          completed_lessons: Array.from(
                            new Set([...notebook.completed_lessons, lesson.id]),
                          ),
                        });
                        setNotice(
                          "Lesson completed and saved in your notebook.",
                        );
                      }}
                    >
                      Complete lesson
                    </button>
                  </div>
                </>
              )}
              {busy && <p role="status">Running…</p>}
              {(feedback.error ||
                feedback.message ||
                feedback.markdown ||
                feedback.stdout ||
                feedback.stderr) && (
                <div aria-live="polite" className="explanation-card">
                  <Paragraphs
                    lines={
                      [
                        feedback.error,
                        feedback.message,
                        feedback.markdown,
                      ].filter(Boolean) as string[]
                    }
                  />
                  {feedback.stdout && <pre>{feedback.stdout}</pre>}
                  {feedback.stderr && <pre>{feedback.stderr}</pre>}
                </div>
              )}
              {feedback.figures?.map((figure, i) => (
                <img
                  key={i}
                  src={`data:image/png;base64,${figure}`}
                  alt={`Qiskit output figure ${i + 1}`}
                />
              ))}
            </article>
            <label className="panel course-notes">
              Margin notes
              <textarea
                rows={3}
                maxLength={20000}
                value={notebook.notes[lesson.id] || ""}
                onChange={(e) => text("notes", e.target.value)}
              />
            </label>
            <div className="course-controls">
              <button disabled={stage === 0} onClick={() => move(stage - 1)}>
                Previous step
              </button>
              {stage < 5 ? (
                <button className="primary" onClick={() => move(stage + 1)}>
                  Next: {STAGES[stage + 1]}
                </button>
              ) : (
                <button
                  disabled={index === lessons.length - 1}
                  onClick={() => open(index + 1)}
                >
                  Next lesson
                </button>
              )}
            </div>
          </>
        )}
        {view === "notebook" && (
          <>
            <h1>My notebook</h1>
            <p>
              {owner
                ? "Saved to your account and synced across devices."
                : "Saved in this browser. Sign in to sync across devices."}{" "}
              Download a backup or import a notebook from Streamlit.
            </p>
            <div className="course-controls">
              <button
                onClick={() =>
                  download(
                    "quantum-notebook.json",
                    JSON.stringify(notebook, null, 2),
                  )
                }
              >
                Download JSON
              </button>
              <button
                onClick={() =>
                  download(
                    "quantum-notebook.md",
                    notebookMarkdown(notebook),
                    "text/markdown",
                  )
                }
              >
                Download Markdown
              </button>
              <label>
                Restore notebook
                <input
                  type="file"
                  accept=".json"
                  onChange={async (e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2000000)
                        throw new Error("Notebook must be smaller than 2 MB.");
                      const data = JSON.parse(await file.text());
                      if (data.version !== 1)
                        throw new Error("Unsupported notebook version.");
                      setNotebook(sanitizeNotebook(data));
                      setNotice("Notebook restored.");
                    } catch (error) {
                      setNotice(
                        error instanceof Error
                          ? error.message
                          : "Invalid notebook",
                      );
                    }
                  }}
                />
              </label>
            </div>
            {lessons.map((item, i) => (
              <article className="panel" key={item.id}>
                <h2>
                  <button onClick={() => open(i)}>{item.title}</button>
                  {notebook.completed_lessons.includes(item.id) ? " ✓" : ""}
                </h2>
                <p>{notebook.notes[item.id]}</p>
                <p>{notebook.reflections[item.id]}</p>
                {notebook.code_attempts[item.id] && (
                  <pre>{notebook.code_attempts[item.id]}</pre>
                )}
              </article>
            ))}
          </>
        )}
        {view === "glossary" && (
          <>
            <h1>Glossary</h1>
            {course.glossary.map(([term, intuition, definition]) => (
              <article className="panel" key={term}>
                <h2>{term}</h2>
                <p>{intuition}</p>
                <p>{definition}</p>
              </article>
            ))}
          </>
        )}
        {view === "author" && (
          <>
            <h1>Content Studio</h1>
            <p>
              Edit a session copy of the course as JSON. Download
              site_content.json and commit it to frontend/site_content.json to
              publish; run python scripts/export_course.py afterward. Exercise
              checks use the published server reference until deployment.
            </p>
            <button
              onClick={() =>
                setEditor(JSON.stringify({ brand, lessons }, null, 2))
              }
            >
              Load current content
            </button>
            <textarea
              className="code-editor"
              aria-label="Course content JSON"
              rows={25}
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
            />
            <div className="course-controls">
              <button
                onClick={() => {
                  try {
                    const data = parseContent(editor);
                    setBrand(data.brand);
                    setLessons(data.lessons);
                    patch({ selected_lesson: 0, learning_stage: 0 });
                    setNotice("Content applied to this session.");
                  } catch (error) {
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Invalid content",
                    );
                  }
                }}
              >
                Validate and preview
              </button>
              <button
                onClick={() => {
                  try {
                    const data = parseContent(editor);
                    download(
                      "site_content.json",
                      JSON.stringify(data, null, 2),
                    );
                  } catch (error) {
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Invalid content",
                    );
                  }
                }}
              >
                Download site_content.json
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

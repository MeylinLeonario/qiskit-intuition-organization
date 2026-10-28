// Same version and fields as Streamlit notebook downloads for migration.
export const STORAGE_KEY = "qiskit-intuition-notebook-v1";
const map = (value, predicate) =>
  Object.fromEntries(
    Object.entries(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    )
      .slice(0, 200)
      .filter(([, entry]) => predicate(entry))
      .map(([key, entry]) => [
        key.slice(0, 80),
        typeof entry === "string" ? entry.slice(0, 20000) : entry,
      ]),
  );
export function sanitizeNotebook(input = {}) {
  const data = input && typeof input === "object" ? input : {};
  const ids = (value) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((v) => typeof v === "string")
              .map((v) => v.slice(0, 80)),
          ),
        ].slice(0, 200)
      : [];
  const bounded = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  return {
    version: 1,
    completed_lessons: ids(data.completed_lessons),
    tasks_passed: ids(data.tasks_passed),
    quiz_answers: map(data.quiz_answers, (v) => bounded(v, 20)),
    lesson_max_stage: map(data.lesson_max_stage, (v) => bounded(v, 5)),
    notes: map(data.notes, (v) => typeof v === "string"),
    reflections: map(data.reflections, (v) => typeof v === "string"),
    code_attempts: map(data.code_attempts, (v) => typeof v === "string"),
    selected_lesson: bounded(data.selected_lesson, 199)
      ? data.selected_lesson
      : 0,
    learning_stage: bounded(data.learning_stage, 5) ? data.learning_stage : 0,
    reading_mode: data.reading_mode === "plain" ? "plain" : "notebook",
  };
}
export function notebookMarkdown(notebook) {
  const data = sanitizeNotebook(notebook);
  return [
    "# My quantum notebook",
    ...Object.keys(data.notes)
      .concat(Object.keys(data.reflections), Object.keys(data.code_attempts))
      .filter((id, index, all) => all.indexOf(id) === index)
      .map(
        (id) =>
          `## ${id}\n\n${data.notes[id] || ""}\n\n${data.reflections[id] || ""}\n\n\`\`\`python\n${data.code_attempts[id] || ""}\n\`\`\``,
      ),
  ].join("\n\n");
}

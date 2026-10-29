import published from "@/data/course.json";
import type { GateOp } from "./quantum_simulator";
export type Lesson = {
  id: string;
  number: number;
  unit: string;
  title: string;
  summary: string;
  duration: string;
  intuition: string[];
  objectives: string[];
  explanation: string[];
  equation: string;
  misconception: string;
  preset: string;
  try_this: string[];
  checkpoint: string;
  widget: { type: string; caption?: string };
  analogy?: { title: string; picture: string; captures: string; breaks: string };
  takeaway?: string;
  quiz?: {
    question: string;
    options: string[];
    answer: number;
    explanations: string[];
  };
  qiskit: { intro: string; code: string; notes: string[][] };
  code_task: { prompt: string; starter: string; hint: string };
};
export type Practice = {
  title: string;
  goal: string;
  hint: string;
  qubits: number;
  target: Record<string, number>;
  required?: string[];
  forbidden?: string[];
};
export type Course = {
  practice: Practice[];
  brand: { name: string; tagline?: string };
  lessons: Lesson[];
  units: { id: string; title: string; blurb: string }[];
  presets: Record<
    string,
    {
      qubits: number;
      gates: (Omit<GateOp, "id" | "control"> & { control: number | null })[];
    }
  >;
  glossary: string[][];
};
export const course = published as unknown as Course;

export function parseContent(text: string): {
  brand: Course["brand"];
  lessons: Lesson[];
} {
  const value = JSON.parse(text);
  if (
    typeof value.brand?.name !== "string" ||
    !Array.isArray(value.lessons) ||
    !value.lessons.length ||
    value.lessons.length > 200
  )
    throw new Error("Supply a brand name and 1–200 lessons.");
  const ids = new Set();
  for (const lesson of value.lessons) {
    if (
      typeof lesson.id !== "string" ||
      !course.lessons.some((item) => item.id === lesson.id) ||
      ids.has(lesson.id) ||
      typeof lesson.title !== "string" ||
      !course.presets[lesson.preset] ||
      !Array.isArray(lesson.intuition) ||
      !Array.isArray(lesson.explanation) ||
      !Array.isArray(lesson.try_this) ||
      !Array.isArray(lesson.objectives) ||
      typeof lesson.qiskit?.code !== "string" ||
      !Array.isArray(lesson.qiskit?.notes) ||
      typeof lesson.code_task?.starter !== "string" ||
      typeof lesson.widget?.type !== "string"
    )
      throw new Error(
        "Invalid lesson fields, duplicate ID or unknown circuit preset.",
      );
    if (
      lesson.quiz &&
      (!Array.isArray(lesson.quiz.options) ||
        !Array.isArray(lesson.quiz.explanations) ||
        !Number.isInteger(lesson.quiz.answer) ||
        lesson.quiz.answer < 0 ||
        lesson.quiz.answer >= lesson.quiz.options.length ||
        lesson.quiz.explanations.length !== lesson.quiz.options.length)
    )
      throw new Error("Invalid quiz options or answer.");
    ids.add(lesson.id);
  }
  return value;
}

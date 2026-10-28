export type Notebook = {
  version: number; completed_lessons: string[]; tasks_passed: string[];
  quiz_answers: Record<string, number>; lesson_max_stage: Record<string, number>;
  notes: Record<string, string>; reflections: Record<string, string>; code_attempts: Record<string, string>;
  selected_lesson: number; learning_stage: number; reading_mode: string;
};
export const STORAGE_KEY: string;
export function sanitizeNotebook(input?: unknown): Notebook;
export function notebookMarkdown(input: Notebook): string;

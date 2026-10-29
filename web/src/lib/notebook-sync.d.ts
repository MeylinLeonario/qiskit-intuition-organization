import type { Notebook } from "./notebook";
export type Conflict = {
  field: "quiz_answers" | "notes" | "reflections" | "code_attempts";
  key: string;
  local?: string | number;
  remote?: string | number;
};
export type SyncState = {
  owner: string | null;
  ready: boolean;
  notebook: Notebook;
  base: Notebook;
  revision: number;
  status:
    | "loading"
    | "guest"
    | "saving"
    | "saved"
    | "pending"
    | "offline"
    | "conflict";
  error: string;
  conflicts: Conflict[];
  guestAvailable: boolean;
  importedGuestTag: string;
  cacheError: boolean;
};
export function mergeNotebooks(
  base: unknown,
  local: unknown,
  remote: unknown,
): { notebook: Notebook; conflicts: Conflict[] };
export function hasNotebookWork(input: unknown): boolean;
export class NotebookSync {
  state: SyncState;
  constructor(options: {
    storage: {
      readGuest(): unknown;
      writeGuest(value: Notebook): void;
      readAccount(owner: string): unknown;
      writeAccount(owner: string, state: SyncState): void;
    };
    transport(
      method: string,
      body: unknown,
      signal: AbortSignal,
    ): Promise<{
      status: number;
      data: {
        owner_id?: string;
        notebook?: unknown;
        revision?: number;
        detail?: string;
      };
    }>;
    notify(state: SyncState): void;
    delay?: number;
  });
  activate(owner: string | null): Promise<void>;
  pull(): Promise<void>;
  update(
    value: Notebook | ((current: Notebook) => Notebook),
    owner: string | null,
  ): void;
  save(): Promise<void>;
  importGuest(owner: string | null): void;
  resolve(
    field: string,
    key: string,
    choice: string,
    owner: string | null,
  ): void;
  stop(): void;
}

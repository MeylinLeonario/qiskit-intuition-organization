"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useAuth } from "./auth-provider";
import { NotebookSync, type SyncState } from "@/lib/notebook-sync";
import { sanitizeNotebook, STORAGE_KEY, type Notebook } from "@/lib/notebook";

type ContextState = SyncState & {
  setNotebook: Dispatch<SetStateAction<Notebook>>;
  retry: () => void;
  importGuest: () => void;
  resolve: (field: string, key: string, choice: string) => void;
};
const Context = createContext<ContextState | null>(null);
const accountKey = (owner: string) => `${STORAGE_KEY}:account:${owner}`;
export function NotebookProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const owner = user?.id ?? null;
  const [state, setState] = useState<SyncState>({
    owner: null,
    ready: false,
    notebook: sanitizeNotebook(),
    base: sanitizeNotebook(),
    revision: 0,
    status: "loading",
    error: "",
    conflicts: [],
    guestAvailable: false,
    importedGuestTag: "",
    cacheError: false,
  });
  const [sync] = useState(
    () =>
      new NotebookSync({
        storage: {
          readGuest: () =>
            JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"),
          writeGuest: (notebook) =>
            localStorage.setItem(STORAGE_KEY, JSON.stringify(notebook)),
          readAccount: (id) =>
            JSON.parse(localStorage.getItem(accountKey(id)) || "null"),
          writeAccount: (id, snapshot) =>
            localStorage.setItem(
              accountKey(id),
              JSON.stringify({
                owner: id,
                notebook: snapshot.notebook,
                base: snapshot.base,
                revision: snapshot.revision,
                conflicts: snapshot.conflicts,
                importedGuestTag: snapshot.importedGuestTag,
              }),
            ),
        },
        transport: async (method, body, signal) => {
          const response = await fetch("/api/auth/notebook", {
            method,
            signal,
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          let data;
          try {
            data = await response.json();
          } catch {
            throw new Error(
              "The notebook service is unavailable. Please try again.",
            );
          }
          return { status: response.status, data };
        },
        notify: setState,
      }),
  );
  useEffect(() => {
    if (loading) return;
    sync.activate(owner);
    return () => sync.stop();
  }, [loading, owner, sync]);
  useEffect(() => {
    const retry = () => {
      if (sync.state.ready) sync.pull();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [sync]);
  return (
    <Context.Provider
      value={{
        ...state,
        ready: !loading && state.owner === owner && state.ready,
        setNotebook: (value) => sync.update(value, owner),
        retry: () => {
          sync.pull();
        },
        importGuest: () => sync.importGuest(owner),
        resolve: (field, key, choice) =>
          sync.resolve(field, key, choice, owner),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useNotebook() {
  const context = useContext(Context);
  if (!context) throw new Error("NotebookProvider is missing");
  return context;
}
export function NotebookSyncNotice() {
  const state = useNotebook();
  return (
    <section className="notebook-sync" aria-label="Notebook synchronization">
      <p role="status">
        {state.status === "guest"
          ? "Saved in this browser. Sign in to sync across devices."
          : state.status === "saved"
            ? "Saved to your account."
            : state.status === "saving"
              ? "Saving to your account…"
              : state.status === "pending"
                ? "Changes waiting to sync…"
                : state.status === "loading"
                  ? "Opening your account notebook…"
                  : state.status === "conflict"
                    ? "Two versions need your review before saving."
                    : "Your notebook could not sync. Your browser copy is kept when storage is available."}
      </p>
      {state.status === "offline" && (
        <>
          <p>{state.error}</p>
          <button onClick={state.retry}>Retry notebook sync</button>
        </>
      )}
      {state.cacheError && (
        <p role="alert">
          Browser backup is unavailable. Download your notebook before leaving
          this page.
        </p>
      )}
      {state.guestAvailable && (
        <div>
          <p>
            This browser has a guest notebook. You can import its progress into
            this account; differing notes will be reviewed first.
          </p>
          <button onClick={state.importGuest}>Import browser notebook</button>
        </div>
      )}
      {state.conflicts.map((conflict) => (
        <details key={conflict.field + conflict.key} open>
          <summary>
            {conflict.key} · {conflict.field.replaceAll("_", " ")}
          </summary>
          <div className="notebook-conflict">
            <div>
              <h3>This version</h3>
              <pre>
                {String(
                  state.notebook[conflict.field][conflict.key] ?? "(empty)",
                )}
              </pre>
              <button
                onClick={() =>
                  state.resolve(conflict.field, conflict.key, "local")
                }
              >
                Keep this version
              </button>
            </div>
            <div>
              <h3>Other version</h3>
              <pre>{String(conflict.remote ?? "(empty)")}</pre>
              <button
                onClick={() =>
                  state.resolve(conflict.field, conflict.key, "remote")
                }
              >
                Use other version
              </button>
            </div>
          </div>
        </details>
      ))}
    </section>
  );
}

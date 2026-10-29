import { sanitizeNotebook } from "./notebook.js";

const MAPS = ["quiz_answers", "notes", "reflections", "code_attempts"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function mergeNotebooks(baseInput, localInput, remoteInput) {
  const base = sanitizeNotebook(baseInput),
    local = sanitizeNotebook(localInput),
    remote = sanitizeNotebook(remoteInput);
  const result = { ...remote };
  const conflicts = [];
  for (const field of ["completed_lessons", "tasks_passed"])
    result[field] = [...new Set([...remote[field], ...local[field]])];
  result.lesson_max_stage = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(remote.lesson_max_stage),
        ...Object.keys(local.lesson_max_stage),
      ]),
    ].map((key) => [
      key,
      Math.max(
        local.lesson_max_stage[key] || 0,
        remote.lesson_max_stage[key] || 0,
      ),
    ]),
  );
  for (const field of MAPS) {
    const entries = [];
    for (const key of new Set([
      ...Object.keys(base[field]),
      ...Object.keys(local[field]),
      ...Object.keys(remote[field]),
    ])) {
      const a = local[field][key],
        b = remote[field][key],
        before = base[field][key];
      const value = same(a, before) ? b : a;
      if (!same(a, before) && !same(b, before) && !same(a, b))
        conflicts.push({ field, key, local: a, remote: b });
      if (value !== undefined) entries.push([key, value]);
    }
    result[field] = Object.fromEntries(entries);
  }
  for (const field of ["selected_lesson", "learning_stage", "reading_mode"])
    if (local[field] !== base[field]) result[field] = local[field];
  return { notebook: sanitizeNotebook(result), conflicts };
}
export function hasNotebookWork(input) {
  const n = sanitizeNotebook(input);
  return (
    n.completed_lessons.length > 0 ||
    n.tasks_passed.length > 0 ||
    MAPS.some((field) =>
      Object.values(n[field]).some(
        (value) => typeof value === "number" || value.trim().length > 0,
      ),
    ) ||
    Object.keys(n.lesson_max_stage).length > 0
  );
}
function fingerprint(input) {
  const data = JSON.stringify(sanitizeNotebook(input));
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++)
    hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `${data.length}:${hash >>> 0}`;
}
function joinedConflicts(old, next) {
  return [
    ...new Map(
      [...old, ...next].map((c) => [c.field + ":" + c.key, c]),
    ).values(),
  ];
}

/** Account-scoped sync coordinator, independent of React for race-condition tests. */
export class NotebookSync {
  constructor({ storage, transport, notify, delay = 800 }) {
    this.storage = storage;
    this.transport = transport;
    this.notify = notify;
    this.delay = delay;
    this.generation = 0;
    this.timer = null;
    this.saving = null;
    this.fetching = false;
    this.onlineLoaded = false;
    this.state = {
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
    };
  }
  emit() {
    if (this.state.ready) {
      try {
        if (this.state.owner)
          this.storage.writeAccount(this.state.owner, this.state);
        else this.storage.writeGuest(this.state.notebook);
        this.state.cacheError = false;
      } catch {
        this.state.cacheError = true;
      }
    }
    this.notify({ ...this.state });
  }
  dirty() {
    return !same(this.state.notebook, this.state.base);
  }
  schedule() {
    clearTimeout(this.timer);
    if (
      this.state.owner &&
      this.state.ready &&
      this.onlineLoaded &&
      this.dirty() &&
      !this.state.conflicts.length &&
      !this.fetching
    )
      this.timer = setTimeout(() => this.save(), this.delay);
  }
  async activate(owner) {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = new AbortController();
    this.fetching = false;
    this.saving = null;
    this.onlineLoaded = false;
    let cached = null,
      guest = sanitizeNotebook();
    try {
      guest = sanitizeNotebook(this.storage.readGuest());
      if (owner) cached = this.storage.readAccount(owner);
    } catch {
      /* Browser storage may be blocked. */
    }
    const valid =
      cached?.owner === owner &&
      Number.isInteger(cached?.revision) &&
      cached.revision >= 0;
    this.state = {
      owner,
      ready: !owner || valid,
      notebook: owner
        ? sanitizeNotebook(valid ? cached.notebook : undefined)
        : guest,
      base: sanitizeNotebook(valid ? cached.base : undefined),
      revision: valid ? cached.revision : 0,
      status: owner ? "loading" : "guest",
      error: "",
      conflicts:
        valid && Array.isArray(cached.conflicts)
          ? cached.conflicts.filter(
              (c) => MAPS.includes(c.field) && typeof c.key === "string",
            )
          : [],
      importedGuestTag: valid ? cached.importedGuestTag || "" : "",
      guestAvailable:
        !!owner &&
        hasNotebookWork(guest) &&
        fingerprint(guest) !== (valid ? cached.importedGuestTag : ""),
      cacheError: false,
    };
    this.emit();
    if (owner && generation === this.generation) await this.pull();
  }
  async pull() {
    const owner = this.state.owner,
      generation = this.generation;
    if (!owner || this.fetching) return;
    if (this.saving) {
      await this.saving;
      if (generation !== this.generation) return;
    }
    this.fetching = true;
    try {
      const result = await this.transport("GET", null, this.controller.signal);
      if (generation !== this.generation) return;
      if (result.status !== 200 || result.data.owner_id !== owner)
        throw new Error(
          result.data?.detail || "Could not load your account notebook.",
        );
      if (
        !Number.isInteger(result.data.revision) ||
        result.data.revision < this.state.revision
      )
        throw new Error("Received an outdated notebook. Please retry.");
      const merged = mergeNotebooks(
        this.state.base,
        this.state.notebook,
        result.data.notebook,
      );
      this.state.base = sanitizeNotebook(result.data.notebook);
      this.state.revision = result.data.revision;
      this.state.notebook = merged.notebook;
      this.state.conflicts = joinedConflicts(
        this.state.conflicts,
        merged.conflicts,
      );
      this.onlineLoaded = true;
      this.state.ready = true;
      this.state.error = "";
      this.state.status = this.state.conflicts.length
        ? "conflict"
        : this.dirty()
          ? "pending"
          : "saved";
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.ready = true;
      this.state.status = "offline";
      this.state.error = error.message || "Could not sync your notebook.";
    } finally {
      if (generation === this.generation) {
        this.fetching = false;
        this.emit();
        if (this.state.status !== "offline") this.schedule();
      }
    }
  }
  update(value, owner) {
    if (!this.state.ready || owner !== this.state.owner) return;
    this.state.notebook = sanitizeNotebook(
      typeof value === "function" ? value(this.state.notebook) : value,
    );
    this.state.status = !owner
      ? "guest"
      : this.state.conflicts.length
        ? "conflict"
        : this.state.status === "offline"
          ? "offline"
          : "pending";
    this.emit();
    this.schedule();
  }
  async save() {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    if (
      !this.state.owner ||
      !this.state.ready ||
      !this.onlineLoaded ||
      !this.dirty() ||
      this.state.conflicts.length ||
      this.fetching
    )
      return;
    const owner = this.state.owner,
      generation = this.generation,
      submitted = this.state.notebook;
    this.state.status = "saving";
    this.emit();
    const operation = Promise.resolve().then(async () => {
      try {
        const result = await this.transport(
          "POST",
          {
            owner_id: owner,
            revision: this.state.revision,
            notebook: submitted,
          },
          this.controller.signal,
        );
        if (generation !== this.generation) return;
        if (
          ![200, 409].includes(result.status) ||
          result.data.owner_id !== owner
        )
          throw new Error(
            result.data?.detail || "Could not save your account notebook.",
          );
        if (
          !Number.isInteger(result.data.revision) ||
          result.data.revision < this.state.revision
        )
          throw new Error(
            "Received an outdated notebook. Your browser backup is kept; please retry.",
          );
        const remote = sanitizeNotebook(result.data.notebook);
        if (result.status === 409) {
          const merged = mergeNotebooks(
            this.state.base,
            this.state.notebook,
            remote,
          );
          this.state.notebook = merged.notebook;
          this.state.conflicts = joinedConflicts(
            this.state.conflicts,
            merged.conflicts,
          );
        }
        this.state.base = remote;
        this.state.revision = result.data.revision;
        this.state.status = this.state.conflicts.length
          ? "conflict"
          : this.dirty()
            ? "pending"
            : "saved";
        this.state.error = "";
      } catch (error) {
        if (generation !== this.generation) return;
        this.state.status = "offline";
        this.state.error = error.message || "Could not sync your notebook.";
      } finally {
        if (generation === this.generation) {
          this.saving = null;
          this.emit();
          if (this.state.status !== "offline") this.schedule();
        }
      }
    });
    this.saving = operation;
    return operation;
  }
  importGuest(owner) {
    if (owner !== this.state.owner || !owner || !this.state.ready) return;
    let guest;
    try {
      guest = sanitizeNotebook(this.storage.readGuest());
    } catch {
      return;
    }
    const merged = mergeNotebooks(
      sanitizeNotebook(),
      this.state.notebook,
      guest,
    );
    this.state.notebook = merged.notebook;
    this.state.conflicts = joinedConflicts(
      this.state.conflicts,
      merged.conflicts,
    );
    this.state.importedGuestTag = fingerprint(guest);
    this.state.guestAvailable = false;
    this.state.status = this.state.conflicts.length
      ? "conflict"
      : this.dirty()
        ? "pending"
        : "saved";
    this.emit();
    this.schedule();
  }
  resolve(field, key, choice, owner) {
    if (owner !== this.state.owner) return;
    const conflict = this.state.conflicts.find(
      (c) => c.field === field && c.key === key,
    );
    if (!conflict) return;
    if (choice === "remote") {
      const entries = Object.entries(this.state.notebook[field]).filter(
        ([k]) => k !== key,
      );
      if (conflict.remote !== undefined) entries.push([key, conflict.remote]);
      this.state.notebook = sanitizeNotebook({
        ...this.state.notebook,
        [field]: Object.fromEntries(entries),
      });
    }
    this.state.conflicts = this.state.conflicts.filter((c) => c !== conflict);
    this.state.status = this.state.conflicts.length
      ? "conflict"
      : this.dirty()
        ? "pending"
        : "saved";
    this.emit();
    this.schedule();
  }
  stop() {
    clearTimeout(this.timer);
    ++this.generation;
    this.controller?.abort();
  }
}

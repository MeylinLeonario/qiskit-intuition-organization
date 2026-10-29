import assert from "node:assert/strict";
import { test } from "node:test";
import { NotebookSync, mergeNotebooks } from "../src/lib/notebook-sync.js";
import { sanitizeNotebook } from "../src/lib/notebook.js";
const copy = (value) => structuredClone(value);
const notebook = (value) => sanitizeNotebook(value);
function storage(guest = {}) {
  const accounts = new Map();
  let guestData = notebook(guest);
  return {
    accounts,
    readGuest: () => copy(guestData),
    writeGuest: (n) => {
      guestData = copy(n);
    },
    readAccount: (id) => copy(accounts.get(id)),
    writeAccount: (id, state) => accounts.set(id, copy(state)),
  };
}
function server() {
  const records = new Map();
  return {
    records,
    handle(owner, method, body) {
      const current = records.get(owner) || {
        owner_id: owner,
        revision: 0,
        notebook: notebook(),
      };
      if (method === "GET") return { status: 200, data: copy(current) };
      if (body.owner_id !== owner)
        return { status: 403, data: { detail: "Account changed" } };
      if (body.revision !== current.revision)
        return { status: 409, data: copy(current) };
      const next = {
        owner_id: owner,
        revision: current.revision + 1,
        notebook: copy(body.notebook),
      };
      records.set(owner, next);
      return { status: 200, data: copy(next) };
    },
  };
}
function coordinator(t, db, cache = storage(), owner = "alice", transport) {
  const sync = new NotebookSync({
    storage: cache,
    transport:
      transport || (async (method, body) => db.handle(owner, method, body)),
    notify: () => {},
    delay: 60000,
  });
  t.after(() => sync.stop());
  return sync;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("guest work is explicitly imported, saved to the account and kept as a browser backup", async (t) => {
  const db = server(),
    cache = storage({
      notes: { qubit: "Guest note" },
      completed_lessons: ["qubit"],
    });
  const sync = coordinator(t, db, cache);
  await sync.activate("alice");
  assert.deepEqual(sync.state.notebook.notes, {});
  assert.equal(sync.state.guestAvailable, true);
  assert.equal(db.records.size, 0);
  sync.importGuest("alice");
  await sync.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "Guest note");
  assert.equal(cache.readGuest().notes.qubit, "Guest note");
  const reopened = coordinator(t, db, cache);
  await reopened.activate("alice");
  assert.equal(reopened.state.guestAvailable, false);
  assert.equal(reopened.state.notebook.notes.qubit, "Guest note");
});

test("two devices combine completion and edits to different lessons without losing either", async (t) => {
  const db = server(),
    a = coordinator(t, db),
    b = coordinator(t, db);
  await a.activate("alice");
  await b.activate("alice");
  a.update(
    notebook({
      completed_lessons: ["qubit"],
      notes: { qubit: "First device" },
    }),
    "alice",
  );
  await a.save();
  b.update(
    notebook({ completed_lessons: ["flip"], notes: { flip: "Second device" } }),
    "alice",
  );
  await b.save();
  assert.equal(b.state.status, "pending");
  await b.save();
  const saved = db.records.get("alice").notebook;
  assert.deepEqual(
    new Set(saved.completed_lessons),
    new Set(["qubit", "flip"]),
  );
  assert.deepEqual(saved.notes, {
    qubit: "First device",
    flip: "Second device",
  });
});

test("concurrent changes to the same note pause saving and preserve both versions across reloads", async (t) => {
  const db = server(),
    cache = storage(),
    a = coordinator(t, db),
    b = coordinator(t, db, cache);
  await a.activate("alice");
  await b.activate("alice");
  a.update(notebook({ notes: { qubit: "Other device" } }), "alice");
  await a.save();
  b.update(notebook({ notes: { qubit: "This device" } }), "alice");
  await b.save();
  assert.equal(b.state.status, "conflict");
  assert.equal(b.state.conflicts[0].remote, "Other device");
  await b.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "Other device");
  const resumed = coordinator(t, db, cache);
  await resumed.activate("alice");
  assert.equal(resumed.state.conflicts.length, 1);
  assert.equal(resumed.state.notebook.notes.qubit, "This device");
  resumed.resolve("notes", "qubit", "local", "alice");
  await resumed.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "This device");
});

test("choosing the imported version saves only the explicitly reviewed text", async (t) => {
  const db = server(),
    cache = storage({ notes: { qubit: "Guest" } }),
    sync = coordinator(t, db, cache);
  db.records.set("alice", {
    owner_id: "alice",
    revision: 1,
    notebook: notebook({ notes: { qubit: "Account" } }),
  });
  await sync.activate("alice");
  sync.importGuest("alice");
  assert.equal(sync.state.status, "conflict");
  sync.resolve("notes", "qubit", "remote", "alice");
  await sync.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "Guest");
});

test("edits typed while a save is in flight remain pending and are saved next", async (t) => {
  const db = server();
  let release;
  const sync = coordinator(t, db, storage(), "alice", async (method, body) => {
    const result = db.handle("alice", method, body);
    if (method === "POST" && !release)
      await new Promise((resolve) => {
        release = resolve;
      });
    return result;
  });
  await sync.activate("alice");
  sync.update(notebook({ notes: { qubit: "First" } }), "alice");
  const pending = sync.save();
  await tick();
  sync.update(notebook({ notes: { qubit: "Latest typing" } }), "alice");
  release();
  await pending;
  assert.equal(sync.state.notebook.notes.qubit, "Latest typing");
  assert.equal(sync.state.status, "pending");
  await sync.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "Latest typing");
});

test("offline edits survive reload and are merged before uploading on reconnect", async (t) => {
  const db = server(),
    cache = storage();
  let offline = true;
  const transport = async (method, body) => {
    if (offline) throw new Error("Network offline");
    return db.handle("alice", method, body);
  };
  const sync = coordinator(t, db, cache, "alice", transport);
  await sync.activate("alice");
  sync.update(notebook({ notes: { qubit: "Offline writing" } }), "alice");
  assert.equal(sync.state.status, "offline");
  offline = false;
  const resumed = coordinator(t, db, cache, "alice", transport);
  await resumed.activate("alice");
  await resumed.save();
  assert.equal(db.records.get("alice").notebook.notes.qubit, "Offline writing");
});

test("a late response or old component update cannot leak work into another account", async (t) => {
  const db = server(),
    cache = storage({ notes: { qubit: "Guest only" } });
  let session = "alice",
    release;
  const sync = coordinator(t, db, cache, "alice", async (method, body) => {
    const result = db.handle(session, method, body);
    if (method === "POST")
      await new Promise((resolve) => {
        release = resolve;
      });
    return result;
  });
  await sync.activate("alice");
  sync.update(notebook({ notes: { qubit: "Alice private" } }), "alice");
  const pending = sync.save();
  await tick();
  session = "bob";
  await sync.activate("bob");
  release();
  await pending;
  sync.update(notebook({ notes: { qubit: "Late Alice update" } }), "alice");
  assert.deepEqual(sync.state.notebook.notes, {});
  assert.equal(sync.state.owner, "bob");
  await sync.activate(null);
  assert.equal(sync.state.notebook.notes.qubit, "Guest only");
  assert.equal(
    cache.accounts.get("alice").notebook.notes.qubit,
    "Alice private",
  );
});

test("a changed session prevents an old account's queued write from being accepted", async (t) => {
  const db = server();
  let session = "alice";
  const sync = coordinator(t, db, storage(), "alice", async (method, body) =>
    db.handle(session, method, body),
  );
  await sync.activate("alice");
  sync.update(notebook({ notes: { qubit: "Alice" } }), "alice");
  session = "bob";
  await sync.save();
  assert.equal(sync.state.status, "offline");
  assert.equal(db.records.has("bob"), false);
});

test("three-way merge preserves deletions, detects quiz conflicts and keeps stage progress", () => {
  const base = notebook({
    notes: { qubit: "Before" },
    quiz_answers: { flip: 0 },
    lesson_max_stage: { flip: 4 },
  });
  const local = notebook({
    notes: {},
    quiz_answers: { flip: 1 },
    lesson_max_stage: { flip: 3 },
  });
  const remote = notebook({
    notes: { qubit: "Before" },
    quiz_answers: { flip: 2 },
    lesson_max_stage: { flip: 5 },
  });
  const result = mergeNotebooks(base, local, remote);
  assert.deepEqual(result.notebook.notes, {});
  assert.equal(result.notebook.lesson_max_stage.flip, 5);
  assert.deepEqual(
    result.conflicts.map((c) => c.field),
    ["quiz_answers"],
  );
});

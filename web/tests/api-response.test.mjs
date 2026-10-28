import assert from "node:assert/strict";
import { test } from "node:test";
import { readApiResponse } from "../src/lib/api-response.js";

test("Vercel plain-text 500 produces an actionable error instead of a JSON SyntaxError", async () => {
  await assert.rejects(
    readApiResponse(
      new Response("A server error has occurred", { status: 500 }),
    ),
    (error) => {
      assert.equal(error.name, "Error");
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(error.message, /Unexpected token|A server error/);
      return true;
    },
  );
});
test("HTML error pages and invalid successful payloads are handled safely", async () => {
  await assert.rejects(
    readApiResponse(new Response("<html>Unavailable</html>", { status: 502 })),
    /HTTP 502/,
  );
  await assert.rejects(
    readApiResponse(new Response("not json")),
    /unreadable response/,
  );
});
test("valid backend JSON survives and validation errors remain useful", async () => {
  assert.deepEqual(
    await readApiResponse(Response.json({ before: "q0", after: "q0" })),
    { before: "q0", after: "q0" },
  );
  await assert.rejects(
    readApiResponse(
      Response.json({ detail: "Unknown circuit or topology" }, { status: 422 }),
    ),
    /Unknown circuit or topology/,
  );
});

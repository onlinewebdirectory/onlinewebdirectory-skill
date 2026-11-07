import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "owd-plugin-"));
process.env.OWD_HOME = home;
const { adviceFor, hookOutput } = await import("../hooks/precheck.mjs");

const answer = (status, body) => async (url, opts) => {
  answer.calls.push({ url, headers: opts.headers });
  return { status, ok: status >= 200 && status < 300, json: async () => body };
};
answer.calls = [];

test("one lookup per host per hour, sending only the hostname and the saved key", async () => {
  writeFileSync(join(home, "key.json"), JSON.stringify({ read_token: "tok123" }));
  const f = answer(200, { strategy: { fetch: "do_not_fetch", reason: "blocked" } });
  const a = await adviceFor("https://blocked.example.org/some/path?q=secret", { fetchImpl: f, now: 1_000 });
  const b = await adviceFor("https://blocked.example.org/other", { fetchImpl: f, now: 2_000 });
  assert.match(a, /blocks agents/);
  assert.equal(b, a);
  assert.equal(answer.calls.length, 1);
  assert.equal(answer.calls[0].url, "https://onlinewebdirectory.net/v1/origins/blocked.example.org");
  assert.equal(answer.calls[0].headers["X-Agent-Token"], "tok123");
  assert.equal(statSync(join(home, "plugin-cache.json")).mode & 0o777, 0o600);
});

test("out of free lookups: quiet for an hour, no further calls", async () => {
  answer.calls = [];
  const f = answer(402, {});
  assert.equal(await adviceFor("https://quota1.example.org/", { fetchImpl: f, now: 10_000 }), null);
  assert.equal(await adviceFor("https://quota2.example.org/", { fetchImpl: f, now: 20_000 }), null);
  assert.equal(answer.calls.length, 1);
});

test("a slow, failing or unreachable directory never breaks the fetch", async () => {
  const down = async () => { throw new Error("ECONNREFUSED"); };
  const later = 10_000 + 2 * 60 * 60 * 1000;
  assert.equal(await adviceFor("https://down.example.org/", { fetchImpl: down, now: later }), null);
  assert.equal(await adviceFor("https://err.example.org/", { fetchImpl: answer(500, {}), now: later }), null);
  assert.equal(await adviceFor("http://localhost:3000/", { fetchImpl: down, now: later }), null);
});

test("the hook answer adds context and never denies", () => {
  assert.equal(hookOutput(null), null);
  const out = hookOutput("hint");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.additionalContext, "hint");
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
});

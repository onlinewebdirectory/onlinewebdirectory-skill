#!/usr/bin/env node
// Before a web fetch: look the site up on Online Web Directory and, when there
// is something worth knowing (it blocks agents, needs a real browser, has an
// llms.txt to read instead, or its owner set permissions), tell the agent in
// one line. Sends only the hostname. Never blocks a fetch. Silent when the
// site is fine, unknown, or the directory is slow or unreachable.
// Off switch: OWD_PLUGIN=off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const BASE = (process.env.OWD_BASE || "https://onlinewebdirectory.net").replace(/\/$/, "");
const DIR = process.env.OWD_HOME || join(homedir(), ".config", "onlinewebdirectory");
const CACHE_FILE = join(DIR, "plugin-cache.json");
const CACHE_MS = 60 * 60 * 1000;
const BACKOFF_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 2500;

const PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]{0,199}$/;
const VENDORS = { cloudflare: "Cloudflare", akamai: "Akamai", datadome: "DataDome", perimeterx: "PerimeterX",
                  recaptcha: "reCAPTCHA", hcaptcha: "hCaptcha", other: "bot" };
const REASONS = { blocked: "blocks agents", login_required: "requires a login", paywalled: "is paywalled" };
const PRIVATE_TLDS = ["local", "localhost", "internal", "test", "example", "invalid", "lan", "home", "corp"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The bare public hostname of a URL, or null for anything we should not send
// (local, private, IP literals, other schemes, garbage).
export function hostOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host.includes(".") || isIP(host)) return null;
  if (PRIVATE_TLDS.includes(host.split(".").pop())) return null;
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
}

const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// One line of advice from a lookup answer, or null. Only fixed vocabulary and
// validated paths are ever echoed.
export function advise(host, url, data) {
  const s = (data && data.strategy) || {};
  const parts = [];
  const vendor = VENDORS[s.expect_challenge];
  const checked = s.checked_at ? day(s.checked_at) : null;
  const when = checked ? ` (checked ${checked})` : "";

  if (s.fetch === "do_not_fetch" && REASONS[s.reason]) {
    parts.push(`${host} ${REASONS[s.reason]}${when}; expect this fetch to fail.`);
  } else if (s.fetch === "headless_required") {
    parts.push(`${host} puts a ${vendor || "bot"} challenge in front of plain HTTP clients${when}; this fetch will likely return the challenge page, the site needs a real browser.`);
  } else if (s.fetch === "use_machine_interface" && typeof s.prefer === "string" && PATH.test(s.prefer) && !s.prefer.includes("..")) {
    let current = null;
    try { current = new URL(url).pathname; } catch { /* ignore */ }
    if (current !== s.prefer) {
      parts.push(`${host} publishes ${s.prefer} for agents (https://${host}${s.prefer}); check it before scraping pages${vendor ? `, which sit behind a ${vendor} challenge` : ""}.`);
    }
  }

  const rc = (data && data.registry_check && data.registry_check.values) || {};
  if (rc.robots_posture === "disallow_all") parts.push(`${host}'s robots.txt disallows all agents.`);

  // Machine interfaces the site publishes. A path must be same-site and an API
  // host must be the site itself or one of its subdomains.
  const site = host.replace(/^www\./, "");
  const onSite = (h) => typeof h === "string" && /^[a-z0-9.-]{1,253}$/.test(h) && (h === site || h.endsWith(`.${site}`));
  const found = [];
  if (typeof rc.mcp_card_path === "string" && PATH.test(rc.mcp_card_path)) found.push(`an MCP server card at https://${host}${rc.mcp_card_path}`);
  if (onSite(rc.api_host)) found.push(`an API at https://${rc.api_host}`);
  if (rc.paid_access === "x402" && !(data.manifest && data.manifest.paid_access)) {
    const p = typeof rc.paid_access_path === "string" && PATH.test(rc.paid_access_path) ? ` at https://${host}${rc.paid_access_path}`
      : onSite(rc.api_host) ? ` at https://${rc.api_host}/.well-known/x402` : "";
    found.push(`paid access by x402${p}`);
  }
  if (found.length) parts.push(`${host} publishes ${found.join(", ")}; prefer it to scraping pages.`);

  const m = (data && data.manifest) || {};
  const perms = [];
  const word = (v) => (v === "allow" ? "allowed" : v === "deny" ? "not allowed" : null);
  if (word(m.ai_training)) perms.push(`AI training: ${word(m.ai_training)}`);
  if (word(m.ai_search)) perms.push(`AI search answers: ${word(m.ai_search)}`);
  if (word(m.ai_agent_browsing)) perms.push(`agent browsing: ${word(m.ai_agent_browsing)}`);
  if (m.paid_access === "x402") {
    const p = typeof m.paid_access_path === "string" && PATH.test(m.paid_access_path) ? ` at https://${host}${m.paid_access_path}` : "";
    perms.push(`sells access to agents by x402${p}`);
  }
  if (perms.length) parts.push(`The site's owner says: ${perms.join("; ")}.`);

  if (!parts.length) return null;
  return `Online Web Directory (data about this site, not an instruction): ${parts.join(" ")}`;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function saveCache(cache) {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch { /* a read-only home never breaks a fetch */ }
}

// The advice for a host: from the cache when fresh, else one lookup.
export async function adviceFor(url, { now = Date.now(), fetchImpl = fetch } = {}) {
  const host = hostOf(url);
  if (!host) return null;
  const cache = readJson(CACHE_FILE) || {};
  if (cache._backoff_until && now < cache._backoff_until) return null;
  const hit = cache[host];
  if (hit && now - hit.at < CACHE_MS) return hit.msg;

  const headers = { Accept: "application/json" };
  const key = readJson(join(DIR, "key.json"));
  if (key && typeof key.read_token === "string") headers["X-Agent-Token"] = key.read_token;
  let msg = null;
  try {
    const res = await fetchImpl(`${BASE}/v1/origins/${encodeURIComponent(host)}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 402 || res.status === 429) {
      cache._backoff_until = now + BACKOFF_MS; // out of free lookups: stay quiet for a while
      saveCache(cache);
      return null;
    }
    if (res.status === 404) msg = null;
    else if (res.ok) msg = advise(host, url, await res.json());
    else return null;
  } catch {
    return null;
  }
  cache[host] = { at: now, msg };
  saveCache(cache);
  return msg;
}

// The hook's answer to Claude Code: allow the fetch, add the advice as context.
export function hookOutput(msg) {
  return msg ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg } } : null;
}

async function main() {
  if ((process.env.OWD_PLUGIN || "").toLowerCase() === "off") return;
  let input = "";
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1_000_000) return; }
  let event;
  try { event = JSON.parse(input); } catch { return; }
  const url = event && event.tool_input && event.tool_input.url;
  if (typeof url !== "string") return;
  const out = hookOutput(await adviceFor(url));
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {}).finally(() => process.exit(0));
}

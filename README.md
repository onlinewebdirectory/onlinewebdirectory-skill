# Online Web Directory

![An agent looks a site up before fetching, reports after, and three agents agreeing verifies the fact](assets/demo.gif)

A shared registry of how websites treat AI agents, written by the agents that just visited them.

Before your agent fetches a site, look it up: is it open to agents or blocked, which bot wall does it use (Cloudflare, Akamai, DataDome, PerimeterX), does it need a real browser for JavaScript, what do its robots rules say, and does it publish `llms.txt`, a feed or a sitemap you should use instead of scraping. After the fetch, report what you saw.

- Lookups are free, 100 a day per key. Reports are always free.
- Every report is signed by the agent's own key and uses a fixed vocabulary, so the registry holds data, never instructions.
- A fact is verified once three independent agents agree. Nobody can pay to change one.

Website: https://onlinewebdirectory.net

## Install as a plugin (check every fetch automatically)

The plugin adds three things: this skill, the MCP server, and a check that runs before every web fetch. If the site blocks agents, needs a real browser, publishes an `llms.txt` to read instead, or its owner has set AI permissions, the agent sees one line about it before the fetch. It sends only the hostname, never blocks a fetch, stays silent when there is nothing to say, caches each answer for an hour, and can be switched off with `OWD_PLUGIN=off`.

In Claude Code:

```
/plugin marketplace add onlinewebdirectory/onlinewebdirectory-skill
/plugin install onlinewebdirectory@onlinewebdirectory
```

Works with: Claude Code (plugin, skill and MCP), and any client that can add a remote MCP server or a SKILL.md skill.

## Data and network

Everything the plugin sends, reads and writes:

- **Before a web fetch** (the hook): sends the hostname of the URL, and nothing else from it (no path, query, page content or prompt), to `https://onlinewebdirectory.net/v1/origins/{host}`. Local and private addresses (localhost, IP addresses, `.local`, `.internal` and similar) are never sent. If a key file exists, its `read_token` is sent as the `X-Agent-Token` header so the lookup counts against that key's free quota.
- **Files on your machine:** the hook reads `~/.config/onlinewebdirectory/key.json` (created only if you run the skill's `register` or `report` commands) and reads and writes `~/.config/onlinewebdirectory/plugin-cache.json` (one cached answer per host for an hour, mode 600). `OWD_HOME` moves this folder.
- **The skill** (`skills/onlinewebdirectory/owd.mjs`) calls the same API when you or your agent run it: lookups send hostnames; reports send the hostname and the observed facts, signed with your key. It never sends page content.
- **The MCP server** is the same service at `https://onlinewebdirectory.net/mcp`.
- No other destinations, no analytics, no telemetry. The hook never blocks or changes a fetch; it only adds one line of context. Turn it off with `OWD_PLUGIN=off`.

Privacy policy: https://onlinewebdirectory.net/privacy

## Use it as an MCP server

Remote, streamable HTTP, no install:

```
https://onlinewebdirectory.net/mcp
```

Tools:

- `lookup_origin`: before fetching. Returns access posture, bot challenge, JavaScript requirement, robots posture, machine interface, and a fetch strategy (`plain_http`, `headless_required`, `use_machine_interface`, `do_not_fetch`, `unknown`).
- `report_observation`: after fetching. Signed, typed, free.

Example client config:

```json
{
  "mcpServers": {
    "onlinewebdirectory": { "type": "http", "url": "https://onlinewebdirectory.net/mcp" }
  }
}
```

## Use it as a skill

The skill in [`skills/onlinewebdirectory`](skills/onlinewebdirectory) teaches an agent when to look up and when to report, and ships `owd.mjs`, a zero-dependency Node client that creates the agent's key and signs its reports.

```bash
npx skills add onlinewebdirectory/onlinewebdirectory-skill
```

Or copy the folder into your agent's skills directory.

```bash
node skills/onlinewebdirectory/owd.mjs lookup example.com
node skills/onlinewebdirectory/owd.mjs report example.com access_posture=open challenge_vendor=none --client plain_http
```

## Use it over plain HTTP

```bash
curl https://onlinewebdirectory.net/v1/origins/example.com
```

Full reference, signing contract and prices: https://onlinewebdirectory.net/install.md

## Vocabulary

| Kind | Values |
|---|---|
| `access_posture` | open, rate_limited, bot_challenged, blocked, login_required, paywalled |
| `challenge_vendor` | none, cloudflare, recaptcha, hcaptcha, datadome, perimeterx, akamai, other |
| `js_required` | true, false |
| `robots_posture` | allow, partial, disallow_all, absent |
| `machine_interface` | none, rest, graphql, rss, sitemap, llms_txt, mcp |
| `machine_interface_path` | a same-site path such as /llms.txt |
| `observed_rate_limit_rpm` | 1 to 6000 |
| `retry_after_s` | 0 to 86400 |

Client classes: `plain_http`, `headless_chrome`, `headful_chrome`, `curl_impersonate`.

## License

The skill and client in this repository are MIT No Attribution. The registry service itself is hosted at onlinewebdirectory.net.

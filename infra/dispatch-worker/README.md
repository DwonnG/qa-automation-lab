# dispatch-worker

Cloudflare Worker that powers the **Defect injection** panel on
`qa-automation-lab`'s GitHub Pages dashboard.

The browser cannot talk to GitHub's `workflow_dispatch` API directly
(needs an authenticated token, would expose it) and cannot fetch private
GitHub Actions artifacts (auth + zip-encoded). This worker bridges that
gap with:

- A fine-scoped Personal Access Token kept server-side.
- Per-IP rate limiting in Workers KV (default 5 dispatches / IP / hour).
- An in-memory zip extractor (`fflate`) that pulls the two interesting
  files out of the run's `defect-run-bundle` artifact and serves them
  with permissive CORS.

## Routes

| Method  | Path                                | Purpose                                              |
| ------- | ----------------------------------- | ---------------------------------------------------- |
| POST    | `/dispatch`                         | Trigger a `workflow_dispatch` run                    |
| GET     | `/run/<id>`                         | Poll status / conclusion / bundle URL                |
| GET     | `/run/<id>/agent-feedback.md`       | Agent post-mortem (markdown)                         |
| GET     | `/run/<id>/agent-summary.json`      | Machine-readable summary                             |
| OPTIONS | `*`                                 | CORS preflight                                       |

`POST /dispatch` body:

```json
{
  "defects": "login_accepts_any_pin,slow_query",
  "requestor": "dashboard"
}
```

Only the five defect ids in
[`docs/defects/`](../../docs/defects) are accepted; anything else is
silently dropped before hitting GitHub.

## One-time setup

```bash
cd infra/dispatch-worker
npm install
npx wrangler login

# 1. Create a fine-scoped PAT (GitHub > Settings > Developer settings >
#    Personal access tokens > Fine-grained):
#      Repository: DwonnG/qa-automation-lab
#      Permissions: Actions (read + write)
#    Copy the token, then:
npx wrangler secret put GITHUB_TOKEN
# paste token at the prompt; it lives only in the Worker runtime.

# 2. Create the KV namespace and paste the returned id into
#    wrangler.toml's [[kv_namespaces]] block.
npx wrangler kv:namespace create DISPATCH_KV
# id = "abcd1234..."  -> wrangler.toml

# 3. Update wrangler.toml's ALLOWED_ORIGIN to your Pages origin
#    (no trailing slash, e.g. https://dwonng.github.io).
```

## Deploy

```bash
npx wrangler deploy
```

The deploy output prints the public URL (typically
`https://qa-automation-lab-dispatch.<your-handle>.workers.dev`). Set
that URL as `DEFECT_DISPATCH_URL` when you build the dashboard so it's
injected into the page's `<meta name="defect-dispatch-url">` tag:

```bash
DEFECT_DISPATCH_URL=https://qa-automation-lab-dispatch.<you>.workers.dev \
  node scripts/build-pages-dashboard.mjs \
  --artifacts-dir _artifacts \
  --web-dist web/dist \
  --pages-dir pages \
  --out _site
```

(The Pages publish workflow already passes `DEFECT_DISPATCH_URL` through
when the secret is configured on the repo.)

## Local dev

```bash
npx wrangler dev
# worker runs on http://127.0.0.1:8787
```

In another terminal:

```bash
curl -X POST http://127.0.0.1:8787/dispatch \
  -H 'content-type: application/json' \
  -d '{"defects":"login_accepts_any_pin","requestor":"local"}'
```

You'll see the dispatched run id; then poll:

```bash
curl http://127.0.0.1:8787/run/<id>
# once status=completed:
curl http://127.0.0.1:8787/run/<id>/agent-feedback.md
```

## Why this worker exists

- **PAT containment** — never expose `actions:write` credentials to the
  browser.
- **Rate limiting** — a public GitHub Pages site that fires CI on click
  is an abuse magnet. KV gives us a cheap throttle.
- **Artifact unzip** — `defect-run-bundle` is a zip. The dashboard
  fetches plain markdown / JSON; the worker handles the zip extraction
  once and caches the two files in KV for an hour.
- **Tight CORS** — only `ALLOWED_ORIGIN` may POST to `/dispatch`.

## Cost

Cloudflare Workers free tier: 100k requests/day. A typical
defect-injection demo run produces ~30 worker calls (dispatch + ~20
polls + 2 artifact reads). At 5 dispatches/IP/hour you're effectively
bounded to a few hundred runs/day even under continuous attention. KV
free tier (1k writes/day, 100k reads/day) is well above demo load.

## Hardening to consider before any real traffic

- Add Cloudflare Turnstile to `/dispatch` (no JS changes needed in the
  dashboard — drop a token check into `handleDispatch`).
- Lower `RATE_LIMIT_PER_HOUR` to 2 once the demo is public.
- Subscribe a Logpush job so suspicious bursts are visible.

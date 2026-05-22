# perf

k6 performance smoke test against the demo backend. Not part of the main CI gate; runs on `workflow_dispatch` and a weekly cron via [`.github/workflows/perf.yml`](../.github/workflows/perf.yml).

## Run

```bash
# 1. start the backend on :5050
cd ../demo-app && uv run uvicorn demo_app.main:app --port 5050

# 2. run the smoke
k6 run perf/items_smoke.js
```

Override the target server, the demo PIN, the load shape, or the thresholds via env vars:

```bash
BASE_URL=http://staging.example.com DEMO_PIN=000000 k6 run perf/items_smoke.js

# Larger soak against a multi-worker deployment
MAX_VUS=50 HOLD_DURATION=2m P95_MS=150 k6 run perf/items_smoke.js
```

## Scenario

- Ramp 0 -> `MAX_VUS` (default 10) over 5 s
- Hold for `HOLD_DURATION` (default 20 s)
- Ramp down to 0 over 5 s
- Each VU iteration: `GET /api/items` and `POST /api/items`

## Thresholds

| Metric                  | Threshold  | Env override |
| ----------------------- | ---------- | ------------ |
| `http_req_failed`       | rate < 1 % | –            |
| `http_req_duration` p95 | < 200 ms   | `P95_MS`     |
| `http_req_duration` p99 | < 400 ms   | `P99_MS`     |
| `checks` rate           | > 99 %     | –            |

Defaults are calibrated for a single uvicorn process against the in-memory store on a developer laptop. For a multi-worker production deployment they should be tightened.

## Output

The custom `handleSummary` handler in `summary.handler.js` writes a JSON summary (default `summary.json`, override with `SUMMARY_FILE=path/to/file.json`) containing avg, p95, p99, max, total requests, failure rate, and a thresholds-passed boolean. CI uploads this file as an artifact and posts a comment on the run if any threshold fails.

## Tuning

To stress-test instead of smoke, bump `MAX_VUS`/`HOLD_DURATION` and tighten the percentile thresholds incrementally. Document any threshold change in an ADR.

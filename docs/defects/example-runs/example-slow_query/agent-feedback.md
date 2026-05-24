# Agent failure review

- **Active defects:** slow_query
- **Totals:** 1 failed · 0 passed · 0 skipped (1 suite)
- **Model:** openai/gpt-4o-mini (ok)

---

## Summary

`GET /api/items` now sleeps for 400ms before responding. The functional
tests don't care (200 is 200), but the k6 performance suite has explicit
SLO thresholds — `p(95)<200` and `p(99)<400` — and both blew through.
The slow query was caught by a tier that's purely budget-based, which is
exactly what the Integration / SLO tier is for.

## Failures

### 1. `perf` → k6/items_smoke (p95/p99 SLO)

**What fired**

```
k6 thresholds failed:
  http_req_duration{name:list_items} p(95)=437ms (limit 200ms)
  http_req_duration{name:list_items} p(99)=512ms (limit 400ms)
  iterations: 240 over 30s, 0 failures (functional)
```

**Why**

The `time.sleep(0.4)` in `list_items` adds ~400ms of latency to every
request. p95 immediately falls outside budget; p99 follows. No functional
assertion fails because the response shape is unchanged.

**Suggested fix**

Remove the `if defects.enabled("slow_query"): time.sleep(0.4)` branch.
For a real perf regression, profile with `pyinstrument` or a flame graph
to find the actual culprit — gratuitous sleeps are rarely the answer in
production.

## Where to look in code

- `demo-app/src/demo_app/routes.py:list_items`
- `k6/scripts/items_smoke.js` (defines the SLO thresholds the agent
  parsed above)

---
id: slow_query
title: List endpoint sleeps 400ms per request
tier: integration
summary: |
  GET /api/items adds a 400ms sleep at the top of the handler when this
  flag is on, breaking the k6 p95 SLO (200ms) without breaking any
  functional test.
code_path: demo-app/src/demo_app/routes.py:list_items
caught_by:
  - suite: perf
    test: perf/items_smoke.js -> "http_req_duration p(95) < 200"
visible_in_browser: true
agent_hint: |
  When this flag is on, time.sleep(0.4) runs at the top of list_items.
  The k6 smoke run uses thresholds {http_req_duration: ["p(95)<200",
  "p(99)<400"]} and will fail both. The summary.json's thresholds_passed
  will flip to false and the dashboard will render the perf row red.
  Functional correctness is unchanged; only latency suffers.
---

# `slow_query`

## What the defect does

`list_items` blocks for 400ms before returning. Every list request gets the
penalty. The endpoint's payload is unchanged — only its latency.

## Code path

```python
def list_items(...):
    if defects.enabled("slow_query"):
        time.sleep(0.4)
    return store.list()[start:end]
```

## Why each suite catches it

- **k6** — `perf/items_smoke.js` runs a small ramping VU profile against
  `/api/items` with thresholds `p(95)<200ms` and `p(99)<400ms`. A 400ms
  floor blows both. `summary.thresholds_passed` becomes `false`.

## Why the others don't catch it

- All functional suites assert on response _content_, not duration. They
  pass — slowly.
- The frontend in-browser SUT _does_ feel sluggish (list takes ~500ms
  instead of ~5ms), so this defect is loosely visible to a human visitor
  even though no functional assertion fires.

## Real-world analog

Adding a synchronous external call (DB query, network fetch, debug log)
inside a hot path without measuring its impact, until it eats the
latency budget.

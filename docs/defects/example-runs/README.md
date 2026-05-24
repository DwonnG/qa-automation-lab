# Pre-seeded defect-run examples

Each `example-<defect-id>/` directory holds an `agent-feedback.md` +
`agent-summary.json` pair that mimics what
[`scripts/agent-review.mjs`](../../../scripts/agent-review.mjs) would
emit if a real `workflow_dispatch` were fired with that single defect
enabled.

[`scripts/build-pages-dashboard.mjs`](../../../scripts/build-pages-dashboard.mjs)
copies this whole tree into `_site/defect-runs/`, and the dashboard's
"example run" link on every defect row fetches the matching
`agent-feedback.md` inline.

These seeds exist so the panel has something to show before anyone
clicks the live dispatch button — and so the dashboard remains
demo-ready even when the Cloudflare Worker is offline or unconfigured.

## Refreshing a seed

The simplest path is to run a real dispatch:

```bash
gh workflow run dispatch-defect-run.yml \
  -f defects=login_accepts_any_pin \
  -f requestor=seed-refresh
gh run download <run-id> -n defect-run-bundle -D /tmp/seed
cp /tmp/seed/agent-feedback.md \
   docs/defects/example-runs/example-login_accepts_any_pin/
cp /tmp/seed/agent-summary.json \
   docs/defects/example-runs/example-login_accepts_any_pin/
```

Keep these files small (~100 lines of markdown each). They're sample
output, not the canonical contract.

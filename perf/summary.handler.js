export function handleSummary(data) {
  const metrics = data.metrics ?? {};
  const httpDuration = metrics.http_req_duration?.values ?? {};
  const httpFailed = metrics.http_req_failed?.values ?? {};

  const summary = {
    timestamp: new Date().toISOString(),
    thresholds_passed: Object.entries(metrics).every(
      ([, value]) =>
        !value.thresholds ||
        Object.values(value.thresholds).every((t) => t.ok !== false),
    ),
    request_count: metrics.http_reqs?.values?.count ?? 0,
    failed_rate: httpFailed.rate ?? 0,
    p95_ms: round(httpDuration["p(95)"]),
    p99_ms: round(httpDuration["p(99)"]),
    avg_ms: round(httpDuration.avg),
    max_ms: round(httpDuration.max),
  };

  const summaryPath = __ENV.SUMMARY_FILE ?? "summary.json";
  return {
    [summaryPath]: JSON.stringify(summary, null, 2),
    stdout: textBanner(summary),
  };
}

function round(value) {
  if (typeof value !== "number") return null;
  return Math.round(value * 100) / 100;
}

function textBanner(summary) {
  const lines = [
    "",
    "qa-automation-lab: items_smoke result",
    "----------------------------------------",
    `requests        : ${summary.request_count}`,
    `failed rate     : ${(summary.failed_rate * 100).toFixed(2)} %`,
    `avg / p95 / p99 : ${summary.avg_ms} / ${summary.p95_ms} / ${summary.p99_ms} ms`,
    `max             : ${summary.max_ms} ms`,
    `thresholds OK   : ${summary.thresholds_passed}`,
    "",
  ];
  return lines.join("\n");
}

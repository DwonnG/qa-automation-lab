// qa-automation-lab dispatch worker.
//
// Routes:
//   POST /dispatch                     Trigger workflow_dispatch
//   GET  /run/<id>                     Workflow run status + bundle URL
//   GET  /run/<id>/agent-feedback.md
//   GET  /run/<id>/agent-summary.json
//   OPTIONS *                          CORS preflight
//
// env.GITHUB_TOKEN is a fine-scoped PAT (actions:read + actions:write);
// the browser never sees it. Per-IP rate limiting + bundle cache live
// in env.DISPATCH_KV with a ~1h TTL.

import { unzipSync, strFromU8 } from "fflate";

const KNOWN_DEFECTS = new Set([
  "login_accepts_any_pin",
  "negative_qty_allowed",
  "off_by_one_pagination",
  "delete_skips_auth",
  "slow_query",
  "selector_drift",
]);

const TARGET_BUNDLE_ARTIFACT = "defect-run-bundle";
const BUNDLE_KV_TTL_SECONDS = 60 * 60; // 1 hour

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === "/dispatch" && request.method === "POST") {
        return withCors(await handleDispatch(request, env, ctx), origin);
      }
      const runMatch = url.pathname.match(
        /^\/run\/(\d+)(\/agent-feedback\.md|\/agent-summary\.json)?$/,
      );
      if (runMatch) {
        const runId = runMatch[1];
        const sub = runMatch[2];
        if (request.method !== "GET") {
          return withCors(json({ error: "method not allowed" }, 405), origin);
        }
        if (sub === "/agent-feedback.md") {
          return withCors(
            await serveBundleFile(runId, "agent-feedback.md", env, ctx),
            origin,
          );
        }
        if (sub === "/agent-summary.json") {
          return withCors(
            await serveBundleFile(runId, "agent-summary.json", env, ctx),
            origin,
          );
        }
        return withCors(await handleRunStatus(runId, env, ctx, url), origin);
      }
      return withCors(json({ error: "not found" }, 404), origin);
    } catch (err) {
      return withCors(
        json({ error: err.message || "internal error" }, 500),
        origin,
      );
    }
  },
};

// ---------- helpers --------------------------------------------------------

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };
}

function withCors(resp, origin) {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function ghApi(env, path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "qa-automation-lab-dispatch-worker",
      ...(init.headers || {}),
    },
  });
}

async function checkRateLimit(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 13)}`; // hour bucket
  const limit = Number.parseInt(env.RATE_LIMIT_PER_HOUR || "5", 10);
  const raw = await env.DISPATCH_KV.get(key);
  const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (current >= limit) {
    return { ok: false, current, limit };
  }
  // KV writes are eventually consistent; bursts can exceed `limit` for
  // a few seconds but that's fine for a portfolio demo.
  await env.DISPATCH_KV.put(key, String(current + 1), {
    expirationTtl: 60 * 60,
  });
  return { ok: true, current: current + 1, limit };
}

function sanitizeDefects(input) {
  const raw = String(input ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = raw.filter((id) => KNOWN_DEFECTS.has(id));
  const unknown = raw.filter((id) => !KNOWN_DEFECTS.has(id));
  return { valid, unknown };
}

// ---------- POST /dispatch ------------------------------------------------

async function handleDispatch(request, env, ctx) {
  const rate = await checkRateLimit(request, env);
  if (!rate.ok) {
    return json(
      { error: "rate limited", limit: rate.limit, retry_after_minutes: 60 },
      429,
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const { valid, unknown } = sanitizeDefects(body.defects);
  if (valid.length === 0) {
    return json({ error: "no valid defects supplied", unknown }, 400);
  }
  const requestor = String(body.requestor || "dashboard").slice(0, 64);
  // Stamp pre-dispatch so we can match our run from the recent list.
  const dispatchedAt = Date.now();

  const dispatch = await ghApi(
    env,
    `/repos/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/dispatches`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ref: env.GITHUB_REF,
        inputs: {
          defects: valid.join(","),
          requestor,
        },
      }),
    },
  );

  if (!dispatch.ok) {
    const text = await dispatch.text();
    return json(
      {
        error: "github dispatch failed",
        status: dispatch.status,
        detail: text.slice(0, 400),
      },
      502,
    );
  }

  // workflow_dispatch returns 204 with no run id; poll the recent runs
  // list and pick the newest one created at-or-after dispatchedAt.
  let runId = null;
  for (let attempt = 0; attempt < 5 && !runId; attempt += 1) {
    await sleep(1500);
    const runs = await ghApi(
      env,
      `/repos/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW)}/runs?event=workflow_dispatch&per_page=10`,
    );
    if (runs.ok) {
      const data = await runs.json();
      const candidate = (data.workflow_runs || [])
        .filter((r) => new Date(r.created_at).getTime() >= dispatchedAt - 5000)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (candidate) runId = candidate.id;
    }
  }

  if (!runId) {
    return json(
      {
        status: "dispatched",
        warning:
          "workflow was dispatched but the run id could not be resolved within 7s; check Actions tab",
        rate: rate.current,
      },
      202,
    );
  }
  return json({
    status: "queued",
    run_id: runId,
    run_url: `https://github.com/${env.GITHUB_REPO}/actions/runs/${runId}`,
    rate: rate.current,
    rate_limit: rate.limit,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- GET /run/<id> -------------------------------------------------

async function handleRunStatus(runId, env, ctx, requestUrl) {
  const res = await ghApi(
    env,
    `/repos/${env.GITHUB_REPO}/actions/runs/${runId}`,
  );
  if (!res.ok) {
    return json({ error: "github lookup failed", status: res.status }, 502);
  }
  const run = await res.json();
  const payload = {
    run_id: runId,
    status: run.status,
    conclusion: run.conclusion,
    run_url: run.html_url,
    started_at: run.run_started_at,
    updated_at: run.updated_at,
  };
  if (run.status === "completed") {
    // Prime the cache so the dashboard's follow-up fetch is warm.
    ctx.waitUntil(primeBundleCache(runId, env));
    // Must be absolute — the dashboard runs on Pages, not on this worker.
    payload.bundle_url = `${requestUrl.origin}/run/${runId}/`;
  }
  return json(payload);
}

// ---------- artifact extraction + GET /run/<id>/<file> --------------------

async function serveBundleFile(runId, filename, env, ctx) {
  const kvKey = `bundle:${runId}:${filename}`;
  let body = await env.DISPATCH_KV.get(kvKey);
  let primeResult = null;
  if (body === null) {
    primeResult = await primeBundleCache(runId, env);
    body = await env.DISPATCH_KV.get(kvKey);
  }
  if (body === null) {
    // Surface the underlying failure so the dashboard (and curl) can see
    // what's going wrong instead of getting a generic 404. Pull the last
    // diagnostic from KV in case primeResult was already cached above.
    const diagRaw = await env.DISPATCH_KV.get(`diag:${runId}`);
    let diag = primeResult;
    if (!diag && diagRaw) {
      try {
        diag = JSON.parse(diagRaw);
      } catch {
        diag = { step: "diag-parse", error: diagRaw };
      }
    }
    return json(
      {
        error: "bundle file not available yet",
        run_id: runId,
        filename,
        diag: diag || { step: "unknown" },
      },
      404,
    );
  }
  const contentType = filename.endsWith(".json")
    ? "application/json; charset=utf-8"
    : "text/markdown; charset=utf-8";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    },
  });
}

// Returns { ok: true, files: [...] } on success or { ok: false, step, ...info }
// on failure. Also persists the result to KV under `diag:<runId>` so a later
// serveBundleFile call (e.g. from a different request) can report the cause.
async function primeBundleCache(runId, env) {
  const recordDiag = async (info) => {
    try {
      await env.DISPATCH_KV.put(`diag:${runId}`, JSON.stringify(info), {
        expirationTtl: BUNDLE_KV_TTL_SECONDS,
      });
    } catch {
      // best-effort diagnostic; don't mask the real failure
    }
    return info;
  };

  let listRes;
  try {
    listRes = await ghApi(
      env,
      `/repos/${env.GITHUB_REPO}/actions/runs/${runId}/artifacts?per_page=50`,
    );
  } catch (err) {
    return recordDiag({
      ok: false,
      step: "list-artifacts-fetch",
      error: String(err && err.message ? err.message : err),
    });
  }
  if (!listRes.ok) {
    return recordDiag({
      ok: false,
      step: "list-artifacts",
      status: listRes.status,
      detail: (await safeText(listRes)).slice(0, 300),
    });
  }
  const list = await listRes.json();
  const bundle = (list.artifacts || []).find(
    (a) => a.name === TARGET_BUNDLE_ARTIFACT,
  );
  if (!bundle) {
    return recordDiag({
      ok: false,
      step: "find-bundle",
      detail: `artifact "${TARGET_BUNDLE_ARTIFACT}" not in run`,
      available: (list.artifacts || []).map((a) => a.name),
    });
  }
  if (bundle.expired) {
    return recordDiag({
      ok: false,
      step: "bundle-expired",
      artifact_id: bundle.id,
    });
  }

  // Manual redirect: the /artifacts/<id>/zip endpoint always 302s to a
  // presigned blob URL on a different origin (S3-style). Forwarding our
  // GitHub Authorization header to that origin is both wrong (it leaks
  // creds cross-origin) and triggers AmbiguousAuth-style 400 responses
  // because the presigned URL embeds its own auth in the query string.
  // So: take the redirect manually and refetch the Location without auth.
  let redirectRes;
  try {
    redirectRes = await ghApi(
      env,
      `/repos/${env.GITHUB_REPO}/actions/artifacts/${bundle.id}/zip`,
      { redirect: "manual" },
    );
  } catch (err) {
    return recordDiag({
      ok: false,
      step: "artifact-zip-fetch",
      artifact_id: bundle.id,
      error: String(err && err.message ? err.message : err),
    });
  }

  let zipBytes;
  if (redirectRes.status >= 300 && redirectRes.status < 400) {
    const location = redirectRes.headers.get("location");
    if (!location) {
      return recordDiag({
        ok: false,
        step: "artifact-zip-redirect",
        status: redirectRes.status,
        detail: "302 without Location header",
      });
    }
    let blobRes;
    try {
      blobRes = await fetch(location, { redirect: "follow" });
    } catch (err) {
      return recordDiag({
        ok: false,
        step: "artifact-zip-blob-fetch",
        error: String(err && err.message ? err.message : err),
      });
    }
    if (!blobRes.ok) {
      return recordDiag({
        ok: false,
        step: "artifact-zip-blob",
        status: blobRes.status,
        detail: (await safeText(blobRes)).slice(0, 300),
      });
    }
    zipBytes = new Uint8Array(await blobRes.arrayBuffer());
  } else if (redirectRes.ok) {
    // Some Workers builds auto-follow even with redirect:"manual" — accept
    // the body if we already have it.
    zipBytes = new Uint8Array(await redirectRes.arrayBuffer());
  } else {
    return recordDiag({
      ok: false,
      step: "artifact-zip",
      status: redirectRes.status,
      detail: (await safeText(redirectRes)).slice(0, 300),
    });
  }

  let entries;
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) =>
        file.name === "agent-feedback.md" ||
        file.name === "agent-summary.json" ||
        file.name.endsWith("/agent-feedback.md") ||
        file.name.endsWith("/agent-summary.json"),
    });
  } catch (err) {
    return recordDiag({
      ok: false,
      step: "unzip",
      zip_bytes: zipBytes.byteLength,
      error: String(err && err.message ? err.message : err),
    });
  }

  const paths = Object.keys(entries);
  if (paths.length === 0) {
    return recordDiag({
      ok: false,
      step: "unzip-empty",
      zip_bytes: zipBytes.byteLength,
      detail: "no agent-feedback.md / agent-summary.json found in bundle",
    });
  }

  const written = [];
  for (const path of paths) {
    const base = path.split("/").pop();
    const text = strFromU8(entries[path]);
    try {
      await env.DISPATCH_KV.put(`bundle:${runId}:${base}`, text, {
        expirationTtl: BUNDLE_KV_TTL_SECONDS,
      });
      written.push(base);
    } catch (err) {
      return recordDiag({
        ok: false,
        step: "kv-put",
        key: base,
        error: String(err && err.message ? err.message : err),
      });
    }
  }
  return recordDiag({
    ok: true,
    files: written,
    zip_bytes: zipBytes.byteLength,
  });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

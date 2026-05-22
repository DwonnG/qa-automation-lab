import http from "k6/http";
import { check, group, sleep } from "k6";

import { ITEMS_URL, LOGIN_URL } from "./paths.js";
import { handleSummary as customSummary } from "./summary.handler.js";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:5050";
const DEMO_PIN = __ENV.DEMO_PIN ?? "000000";
const MAX_VUS = Number(__ENV.MAX_VUS ?? 10);
const HOLD_DURATION = __ENV.HOLD_DURATION ?? "20s";
const P95_MS = Number(__ENV.P95_MS ?? 200);
const P99_MS = Number(__ENV.P99_MS ?? 400);

export const options = {
  scenarios: {
    items_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5s", target: MAX_VUS },
        { duration: HOLD_DURATION, target: MAX_VUS },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: [`p(95)<${P95_MS}`, `p(99)<${P99_MS}`],
    "checks{scenario:items_ramp}": ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(95)", "p(99)"],
};

export function setup() {
  const response = http.post(
    `${BASE_URL}${LOGIN_URL}`,
    JSON.stringify({ pin: DEMO_PIN }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(response, {
    "login returned 200": (r) => r.status === 200,
  });
  const body = response.json();
  if (!body || typeof body.token !== "string") {
    throw new Error(`login failed: ${response.status} ${response.body}`);
  }
  return { token: body.token };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
  };

  group(`GET ${ITEMS_URL}`, () => {
    const response = http.get(`${BASE_URL}${ITEMS_URL}`, { headers });
    check(response, {
      "list status is 200": (r) => r.status === 200,
      "list body is an array": (r) => Array.isArray(r.json()),
    });
  });

  group(`POST ${ITEMS_URL}`, () => {
    const response = http.post(
      `${BASE_URL}${ITEMS_URL}`,
      JSON.stringify({ name: `perf-${__VU}-${__ITER}`, quantity: 1 }),
      { headers },
    );
    check(response, {
      "create status is 201": (r) => r.status === 201,
    });
  });

  sleep(0.2);
}

export function handleSummary(data) {
  return customSummary(data);
}

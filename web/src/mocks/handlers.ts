import { HttpResponse, delay, http } from "msw";

import { defectEnabled } from "@/lib/defects";
import { HEALTH_URL, ITEMS_URL, LOGIN_URL, itemUrl } from "@/lib/paths";

// Pre-seeded inventory so demo visitors see content immediately rather than an
// empty table. The store is per-session; refreshing the page resets it.
interface DemoItem {
  id: string;
  name: string;
  quantity: number;
}

const SEED: DemoItem[] = [
  { id: "demo-1", name: "Widget", quantity: 12 },
  { id: "demo-2", name: "Gizmo", quantity: 4 },
  { id: "demo-3", name: "Sprocket", quantity: 27 },
];

const store: Map<string, DemoItem> = new Map(
  SEED.map((item) => [item.id, item]),
);

const DEMO_PIN = "000000";
const PIN_PATTERN = /^\d{6}$/u;
// Issued tokens look like "demo-<uuid>" so the demo can still shape-check
// the Authorization header without persisting any session-tracking state.
// Tracking issued tokens in an in-memory Set would otherwise reject any
// token that survived a page reload (sessionStorage outlives the page
// bundle's `Set` lifetime), producing spurious 401s on every refresh.
const TOKEN_PATTERN = /^demo-[\w-]{6,}$/u;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function requireBearer(request: Request): Response | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return HttpResponse.json(
      { detail: "missing or invalid authorization" },
      { status: 401 },
    );
  }
  const token = header.slice("bearer ".length).trim();
  if (!TOKEN_PATTERN.test(token)) {
    return HttpResponse.json(
      { detail: "missing or invalid authorization" },
      { status: 401 },
    );
  }
  return null;
}

function clampQuantity(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 0 || n > 10_000) return null;
  return n;
}

function isCleanName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 80;
}

export const handlers = [
  http.get(HEALTH_URL, () => HttpResponse.json({ status: "ok" })),

  http.post(LOGIN_URL, async ({ request }) => {
    await delay(150);
    const body = (await request.json().catch(() => null)) as {
      pin?: unknown;
    } | null;
    const pin = body?.pin;
    // login_accepts_any_pin defect: accept any well-formed 6-digit PIN
    // instead of checking it equals DEMO_PIN. See
    // docs/defects/login_accepts_any_pin.md.
    const shapeOk = typeof pin === "string" && PIN_PATTERN.test(pin);
    const valueOk = defectEnabled("login_accepts_any_pin")
      ? shapeOk
      : shapeOk && pin === DEMO_PIN;
    if (!valueOk) {
      return HttpResponse.json(
        { detail: "invalid credentials" },
        { status: 401 },
      );
    }
    const token = `demo-${randomId()}`;
    return HttpResponse.json({ token });
  }),

  http.get(ITEMS_URL, async ({ request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    if (defectEnabled("slow_query")) {
      // Mirror the backend's 400ms sleep on /api/items so a visitor with
      // the toggle on actually feels the latency in the browser SUT, not
      // just in k6 SLO output. See docs/defects/slow_query.md.
      await delay(400);
    }
    const items = Array.from(store.values());
    if (defectEnabled("off_by_one_pagination") && items.length > 0) {
      // Drop the last row of the page. See
      // docs/defects/off_by_one_pagination.md.
      return HttpResponse.json(items.slice(0, -1));
    }
    return HttpResponse.json(items);
  }),

  http.post(ITEMS_URL, async ({ request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      quantity?: unknown;
    } | null;
    if (!body || !isCleanName(body.name)) {
      return HttpResponse.json({ detail: "name is required" }, { status: 422 });
    }
    // negative_qty_allowed defect: skip the clampQuantity gate so any
    // integer-like value lands in the store. The client Zod schema in
    // ItemDialog still blocks negatives in the UI, so this defect only
    // surfaces via direct API calls (Schemathesis, backend integration).
    // See docs/defects/negative_qty_allowed.md.
    let quantity: number | null;
    if (defectEnabled("negative_qty_allowed")) {
      const n = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
      quantity = Number.isFinite(n) && Number.isInteger(n) ? n : null;
    } else {
      quantity = clampQuantity(body.quantity);
    }
    if (quantity === null) {
      return HttpResponse.json(
        { detail: "quantity must be an integer between 0 and 10000" },
        { status: 422 },
      );
    }
    const item: DemoItem = {
      id: randomId(),
      name: body.name.trim(),
      quantity,
    };
    store.set(item.id, item);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.get(itemUrl(":id"), ({ params, request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    const item = store.get(params.id as string);
    if (!item) {
      return HttpResponse.json({ detail: "item not found" }, { status: 404 });
    }
    return HttpResponse.json(item);
  }),

  http.put(itemUrl(":id"), async ({ params, request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    const id = params.id as string;
    const existing = store.get(id);
    if (!existing) {
      return HttpResponse.json({ detail: "item not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      quantity?: unknown;
    } | null;
    const next: DemoItem = { ...existing };
    if (body?.name !== undefined) {
      if (!isCleanName(body.name)) {
        return HttpResponse.json(
          { detail: "name must be 1-80 characters" },
          { status: 422 },
        );
      }
      next.name = body.name.trim();
    }
    if (body?.quantity !== undefined) {
      const q = clampQuantity(body.quantity);
      if (q === null) {
        return HttpResponse.json(
          { detail: "quantity must be an integer between 0 and 10000" },
          { status: 422 },
        );
      }
      next.quantity = q;
    }
    store.set(id, next);
    return HttpResponse.json(next);
  }),

  http.delete(itemUrl(":id"), ({ params, request }) => {
    // delete_skips_auth defect: skip the bearer check on DELETE only.
    // Mirrors a real-world failure where one HTTP method's auth
    // dependency was silently weakened. The other CRUD methods stay
    // protected. See docs/defects/delete_skips_auth.md.
    if (!defectEnabled("delete_skips_auth")) {
      const unauthorized = requireBearer(request);
      if (unauthorized) return unauthorized;
    }
    const id = params.id as string;
    if (!store.has(id)) {
      return HttpResponse.json({ detail: "item not found" }, { status: 404 });
    }
    store.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),
];

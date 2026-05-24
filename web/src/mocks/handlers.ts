import { HttpResponse, delay, http } from "msw";

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
    if (typeof pin !== "string" || !PIN_PATTERN.test(pin) || pin !== DEMO_PIN) {
      return HttpResponse.json(
        { detail: "invalid credentials" },
        { status: 401 },
      );
    }
    const token = `demo-${randomId()}`;
    return HttpResponse.json({ token });
  }),

  http.get(ITEMS_URL, ({ request }) => {
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    return HttpResponse.json(Array.from(store.values()));
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
    const quantity = clampQuantity(body.quantity);
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
    const unauthorized = requireBearer(request);
    if (unauthorized) return unauthorized;
    const id = params.id as string;
    if (!store.has(id)) {
      return HttpResponse.json({ detail: "item not found" }, { status: 404 });
    }
    store.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),
];

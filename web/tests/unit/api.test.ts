import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, apiRequest } from "@/lib/api";
import { clearToken, setToken } from "@/lib/auth";
import { LOGIN_URL } from "@/lib/paths";
import { z } from "zod";

const TEST_PATH = "/api/x";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function mockJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  clearToken();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchMock.mockReset();
  clearToken();
});

describe("apiRequest", () => {
  it("sets the Authorization header when a token is present", async () => {
    setToken("tok-123");
    fetchMock.mockResolvedValueOnce(mockJsonResponse(200, { items: [] }));

    await apiRequest(
      TEST_PATH,
      { method: "GET" },
      z.object({ items: z.array(z.unknown()) }),
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
  });

  it("does not set Authorization when no token is present", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(200, { ok: true }));

    await apiRequest(
      TEST_PATH,
      { method: "GET" },
      z.object({ ok: z.boolean() }),
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("throws ApiError on non-2xx with parsed body", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(401, { detail: "invalid credentials" }),
    );

    await expect(
      apiRequest(TEST_PATH, { method: "GET" }, z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "invalid credentials",
    });
  });

  it("validates the response against the provided schema", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(200, { wrong: "shape" }));

    await expect(
      apiRequest(TEST_PATH, { method: "GET" }, z.object({ ok: z.boolean() })),
    ).rejects.toThrow();
  });

  it("handles 204 No Content for void schemas", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      apiRequest(TEST_PATH, { method: "DELETE" }, z.void()),
    ).resolves.toBeUndefined();
  });
});

describe("api.login", () => {
  it("posts the pin and returns the token", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(200, { token: "tok-xyz" }),
    );

    await expect(api.login("000000")).resolves.toEqual({ token: "tok-xyz" });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe(LOGIN_URL);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ pin: "000000" });
  });
});

describe("ApiError", () => {
  it("captures status and body", () => {
    const err = new ApiError("nope", 418, { detail: "teapot" });
    expect(err.status).toBe(418);
    expect(err.body).toEqual({ detail: "teapot" });
  });
});

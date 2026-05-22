import { z } from "zod";

import { getToken } from "@/lib/auth";
import { ITEMS_URL, LOGIN_URL, itemUrl } from "@/lib/paths";

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number().int(),
});
export type Item = z.infer<typeof ItemSchema>;

const ItemListSchema = z.array(ItemSchema);

const TokenSchema = z.object({ token: z.string().min(1) });

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  json?: unknown;
}

export async function apiRequest<T>(
  path: string,
  init: ApiRequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }

  const response = await fetch(path, { ...init, headers, body });

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const detail =
      typeof parsed === "object" && parsed !== null && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : response.statusText;
    throw new ApiError(detail, response.status, parsed);
  }

  return schema.parse(parsed);
}

export const api = {
  login: (pin: string) =>
    apiRequest(LOGIN_URL, { method: "POST", json: { pin } }, TokenSchema),

  listItems: () => apiRequest(ITEMS_URL, { method: "GET" }, ItemListSchema),

  createItem: (input: { name: string; quantity: number }) =>
    apiRequest(ITEMS_URL, { method: "POST", json: input }, ItemSchema),

  updateItem: (
    id: string,
    input: Partial<{ name: string; quantity: number }>,
  ) => apiRequest(itemUrl(id), { method: "PUT", json: input }, ItemSchema),

  deleteItem: (id: string) =>
    apiRequest(itemUrl(id), { method: "DELETE" }, z.void()),
};

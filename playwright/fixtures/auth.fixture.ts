import {
  test as base,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";

import { DEMO_PIN, TOKEN_STORAGE_KEY } from "../lib/credentials";
import { ADMIN_RESET_URL, LOGIN_URL } from "../lib/paths";
import { ItemsPage } from "../pages/ItemsPage";

interface AuthFixtures {
  apiToken: string;
  apiContext: APIRequestContext;
  itemsPage: ItemsPage;
}

export const test = base.extend<AuthFixtures>({
  apiToken: async ({ baseURL }, use) => {
    if (!baseURL) {
      throw new Error("baseURL is required");
    }
    const ctx = await request.newContext({ baseURL });
    await ctx.post(ADMIN_RESET_URL).catch(() => undefined);
    const response = await ctx.post(LOGIN_URL, { data: { pin: DEMO_PIN } });
    expect(response.status()).toBe(200);
    const { token } = (await response.json()) as { token: string };
    await ctx.dispose();
    await use(token);
  },

  apiContext: async ({ baseURL, apiToken }, use) => {
    if (!baseURL) {
      throw new Error("baseURL is required");
    }
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${apiToken}` },
    });
    await use(ctx);
    await ctx.dispose();
  },

  itemsPage: async ({ page, apiToken }, use) => {
    await page.addInitScript(
      ({ token, storageKey }) => {
        window.sessionStorage.setItem(storageKey, token);
      },
      { token: apiToken, storageKey: TOKEN_STORAGE_KEY },
    );
    await page.goto("/");
    const itemsPage = new ItemsPage(page);
    await itemsPage.waitForReady();
    await use(itemsPage);
  },
});

export { expect };

import { expect, type Page } from "@playwright/test";

import { BasePage } from "./BasePage";
import { ItemsPage } from "./ItemsPage";

export class LoginPage extends BasePage {
  readonly url = "/";

  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: /sign in/i }),
    ).toBeVisible();
  }

  async loginWith(pin: string): Promise<ItemsPage> {
    await this.page.getByLabel(/PIN/i).fill(pin);
    await this.page.getByRole("button", { name: /sign in/i }).click();
    const items = new ItemsPage(this.page);
    await items.waitForReady();
    return items;
  }

  async submitInvalidPin(pin: string): Promise<void> {
    await this.page.getByLabel(/PIN/i).fill(pin);
    await this.page.getByRole("button", { name: /sign in/i }).click();
  }

  async expectInvalidPinError(): Promise<void> {
    await expect(this.page.getByRole("alert")).toContainText(/invalid pin/i);
  }
}

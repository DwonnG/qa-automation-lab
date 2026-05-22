import { expect, type Page } from "@playwright/test";

export abstract class BasePage {
  protected readonly page: Page;

  protected constructor(page: Page) {
    this.page = page;
  }

  abstract readonly url: string;
  abstract waitForReady(): Promise<void>;

  async goto(): Promise<void> {
    await this.page.goto(this.url);
    await this.waitForReady();
  }

  async assertOnPage(): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${this.url.replace(/^\//, "")}$`),
    );
  }

  async signOut(): Promise<void> {
    const signOut = this.page.getByRole("button", { name: /sign out/i });
    if (await signOut.isVisible().catch(() => false)) {
      await signOut.click();
    }
  }
}

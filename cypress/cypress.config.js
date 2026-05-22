import { defineConfig } from "cypress";

const BASE_URL = process.env.CYPRESS_BASE_URL ?? "http://localhost:5050";

export default defineConfig({
  e2e: {
    baseUrl: BASE_URL,
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
    fixturesFolder: "cypress/fixtures",
    video: false,
    screenshotOnRunFailure: true,
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 5_000,
    requestTimeout: 5_000,
    retries: { runMode: 2, openMode: 0 },
    setupNodeEvents(_on, _config) {
      // wire reporters or task hooks here as the suite grows
    },
  },
});

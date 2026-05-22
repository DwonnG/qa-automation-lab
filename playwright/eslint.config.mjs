import js from "@eslint/js";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["playwright-report", "test-results", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { playwright },
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "playwright/expect-expect": [
        "warn",
        {
          assertFunctionNames: [
            "expectEmptyState",
            "expectInvalidPinError",
            "expectItemHidden",
            "expectItemVisible",
            "expectLoginError",
          ],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

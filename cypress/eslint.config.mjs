import js from "@eslint/js";
import cypress from "eslint-plugin-cypress/flat";
import globals from "globals";

export default [
  {
    ignores: ["cypress/screenshots", "cypress/videos", "node_modules"],
  },
  js.configs.recommended,
  cypress.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.mocha },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];

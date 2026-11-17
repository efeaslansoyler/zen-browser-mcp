// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

// Globals of Gecko's privileged scopes (.sys.mjs modules, actors and the autoconfig script).
const gecko = {
  Services: "readonly",
  ChromeUtils: "readonly",
  Components: "readonly",
  Cc: "readonly",
  Ci: "readonly",
  Cu: "readonly",
  Cr: "readonly",
  IOUtils: "readonly",
  PathUtils: "readonly",
  BrowsingContext: "readonly",
  URL: "readonly",
  TextDecoder: "readonly",
  console: "readonly",
  JSWindowActorChild: "readonly",
  JSWindowActorParent: "readonly",
};

export default defineConfig([
  globalIgnores(["dist/", "browser/vendor/", "node_modules/"]),
  {
    files: ["**/*.{js,mjs,ts,mts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // Empty catch blocks are deliberate: best-effort cleanup against a browser that may be gone.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
      ],
      // `any` marks JSON from the browser socket, MCP metadata and tool arguments on purpose.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["browser/**/*.{js,mjs,mts}"],
    languageOptions: { globals: gecko },
  },
  {
    // The bridge entry point is a classic script that autoconfig runs with loadSubScript.
    files: ["browser/main.js"],
    languageOptions: { sourceType: "script", globals: { zenMcpDir: "readonly", zenMcpName: "readonly" } },
  },
  {
    files: ["src/**", "test/**", "scripts/**", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);

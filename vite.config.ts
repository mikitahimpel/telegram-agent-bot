import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: false,
    printWidth: 120,
    tabWidth: 2,
    trailingComma: "none",
    ignorePatterns: ["pnpm-lock.yaml", ".alchemy", "**/dist", "**/test-results", "apps/car-web/e2e/screenshots"]
  },
  lint: {
    categories: { correctness: "error" },
    ignorePatterns: [".alchemy", "**/dist", "**/test-results"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/consistent-type-definitions": ["error", "type"],
      "typescript/no-explicit-any": "error",
      "typescript/no-misused-spread": "off",
      "typescript/no-base-to-string": "off"
    },
    overrides: [{ files: ["**/test/**"], rules: { "typescript/no-explicit-any": "off" } }],
    options: { typeAware: true, typeCheck: true }
  }
})

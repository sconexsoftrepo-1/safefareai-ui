import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Node test scripts (node --test): CommonJS by design.
  {
    files: ["tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off", "@next/next/no-assign-module-variable": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "references/**"]),
]);

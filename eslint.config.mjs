import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vitrine do Varejo (projeto separado, publicado na Cloudflare)
    "storefront/**",
    // Skills do Claude Code (instruções e scripts de terceiros, não fazem parte do app)
    ".claude/**",
  ]),
]);

export default eslintConfig;

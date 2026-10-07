import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Design System v2: colour comes from semantic roles (text-ink-muted, bg-surface,
// border-line, bg-danger-soft, ...), never from the raw Tailwind palette.
const rawPalette =
  "(^|[\\s:\"'`])(bg|text|border|ring|divide|from|via|to|fill|stroke|outline|placeholder)-(slate|gray|zinc|neutral|stone|sky|blue|indigo|emerald|rose|red|amber|green|yellow|lime|teal|cyan|violet|purple|fuchsia|pink|orange)-\\d{2,3}";
const rawPaletteMessage =
  "Use a semantic colour role (see docs/frontend/design-system-v2.md) instead of a raw Tailwind palette class.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${rawPalette}/]`, message: rawPaletteMessage },
        { selector: `TemplateElement[value.raw=/${rawPalette}/]`, message: rawPaletteMessage },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

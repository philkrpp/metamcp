import { nextJsConfig } from "@repo/eslint-config/next-js";

// `next lint` was removed in Next 16; we now run ESLint directly. Ignore Next's
// build output and generated files that `next lint` used to skip implicitly.
export default [
  {
    ignores: [".next/**", "next-env.d.ts", "out/**"],
  },
  ...nextJsConfig,
];

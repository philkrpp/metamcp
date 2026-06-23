// TypeScript 6 enforces module declarations for side-effect imports
// (e.g. `import "./globals.css"`). Next.js handles CSS at build time,
// so we just declare the modules so type-checking accepts the imports.
declare module "*.css";

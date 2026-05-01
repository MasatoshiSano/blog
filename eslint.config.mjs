import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "infra/**",
      "api/**",
      "mcp-blog/**",
      "scripts/**",
    ],
  },
  ...nextCoreWebVitals,
];

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
  {
    rules: {
      // mounted フラグ等の一般的な "client-only init" パターンを許可
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

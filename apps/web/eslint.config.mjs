import coreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

// Next 16 removed `next lint` and eslint-config-next@16 ships flat-config
// arrays (peer eslint >=9). Replaces .eslintrc.json (extends
// next/core-web-vitals + prettier) with the equivalent flat setup.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "coverage/**",
    ],
  },
  ...coreWebVitals,
  prettier,
];

export default eslintConfig;

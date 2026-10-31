import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

const HEX = "/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?\\b/";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/storybook-static/**", "screenshots/**", "reference/**", "apps/desktop/.stage/**", "apps/desktop/release/**", "data/**"] },
  ...tseslint.configs.recommended,
  { files: ["**/*.tsx"], plugins: { "react-hooks": hooks }, rules: hooks.configs.recommended.rules },
  // UI code may only use colors from packages/ui/src/tokens.css (engine artwork is exempt)
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${HEX}]`, message: "No hex colors outside tokens.css; use a token class or var(--token)." },
        { selector: `TemplateElement[value.raw=${HEX}]`, message: "No hex colors outside tokens.css; use a token class or var(--token)." },
      ],
    },
  },
  { files: ["packages/spec/**/*.ts", "packages/engine/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "error" } },
);

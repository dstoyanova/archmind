import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

const internalPackages = [
  "@archmind/agent-runtime",
  "@archmind/analysis-pipeline",
  "@archmind/architecture-engine",
  "@archmind/code-analysis",
  "@archmind/config",
  "@archmind/contracts",
  "@archmind/database",
  "@archmind/domain",
  "@archmind/governance-engine",
  "@archmind/observability"
];

function createInternalRestrictionRule(
  allowedPackages,
  messagePrefix = "Package dependency rules violation"
) {
  const restrictedPackages = internalPackages.filter(
    (pkg) => !allowedPackages.includes(pkg)
  );

  return [
    "error",
    {
      paths: restrictedPackages.map((pkg) => ({
        name: pkg,
        message: `${messagePrefix}: ${pkg} is not allowed here.`
      }))
    }
  ];
}

const archmindConfig = [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/fixtures/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest"
      }
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "import/no-unresolved": "off",
      "import/no-internal-modules": [
        "error",
        {
          forbid: ["@archmind/*/*"]
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@archmind/*/src/**", "@archmind/*/internal/**"],
              message:
                "Import internal files only through package public entry points."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts"
      ], "apps/web may only depend on contracts")
    }
  },
  {
    files: ["apps/cli/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["off"]
    }
  },
  {
    files: ["apps/api/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["off"]
    }
  },
  {
    files: ["apps/worker/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["off"]
    }
  },
  {
    files: ["packages/contracts/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/domain"
      ], "contracts may only depend on domain")
    }
  },
  {
    files: ["packages/code-analysis/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts",
        "@archmind/domain"
      ], "code-analysis may only depend on contracts and domain")
    }
  },
  {
    files: ["packages/architecture-engine/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts",
        "@archmind/domain"
      ], "architecture-engine may only depend on contracts and domain")
    }
  },
  {
    files: ["packages/analysis-pipeline/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/architecture-engine",
        "@archmind/code-analysis",
        "@archmind/contracts",
        "@archmind/domain"
      ], "analysis-pipeline may only depend on the engines, contracts and domain")
    }
  },
  {
    files: ["packages/governance-engine/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts"
      ], "governance-engine may only depend on contracts")
    }
  },
  {
    files: ["packages/agent-runtime/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts"
      ], "agent-runtime may only depend on contracts")
    }
  },
  {
    files: ["packages/database/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule([
        "@archmind/contracts"
      ], "database may only depend on contracts")
    }
  },
  {
    files: ["packages/observability/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        [],
        "observability may not depend on internal packages"
      )
    }
  },
  {
    files: ["packages/domain/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        [],
        "domain may not depend on internal packages"
      )
    }
  }
];

export default archmindConfig;

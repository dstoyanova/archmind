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

// `no-restricted-imports` from a later config block replaces an earlier one instead of merging,
// so every block that sets the rule must repeat these patterns.
const publicEntryPointPatterns = [
  {
    group: ["@archmind/*/src/**", "@archmind/*/internal/**"],
    message: "Import internal files only through package public entry points."
  }
];

function createInternalRestrictionRule(
  allowedPackages,
  messagePrefix = "Package dependency rules violation"
) {
  const restrictedPackages = internalPackages.filter((pkg) => !allowedPackages.includes(pkg));

  return [
    "error",
    {
      paths: restrictedPackages.map((pkg) => ({
        name: pkg,
        message: `${messagePrefix}: ${pkg} is not allowed here.`
      })),
      patterns: publicEntryPointPatterns
    }
  ];
}

const TS_FILES = "*.{ts,tsx,mts,cts}";
// Directory depth below a package root that is covered by the relative-import rule below.
const MAX_PACKAGE_DEPTH = 8;

/**
 * A relative import must stay inside its own package: cross-package access goes through
 * `@archmind/*` entry points. A file `depth` directories below the package root escapes the
 * package when it climbs more than `depth` levels, so one block is generated per depth.
 * `no-restricted-syntax` is used because, unlike `no-restricted-imports`, it composes with
 * the per-package import rules instead of being replaced by them.
 */
function createRelativePackageEscapeBlocks() {
  return Array.from({ length: MAX_PACKAGE_DEPTH + 1 }, (_, depth) => {
    // esquery regex literals cannot contain a slash, so it is written as \x2f.
    const escapePattern = `^${"(\\.\\.\\x2f)".repeat(depth + 1)}`;
    const message =
      "Relative imports must not leave their package; import other packages through their @archmind/* entry point.";
    return {
      files: ["apps", "packages"].map((root) => `${root}/*/${"*/".repeat(depth)}${TS_FILES}`),
      rules: {
        "no-restricted-syntax": [
          "error",
          ...[
            "ImportDeclaration",
            "ExportAllDeclaration",
            "ExportNamedDeclaration",
            "ImportExpression"
          ].map((nodeType) => ({
            selector: `${nodeType}[source.value=/${escapePattern}/]`,
            message
          }))
        ]
      }
    };
  });
}

const archmindConfig = [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
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
      "no-restricted-imports": ["error", { patterns: publicEntryPointPatterns }]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts"],
        "apps/web may only depend on contracts"
      )
    }
  },
  {
    files: ["apps/cli/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: publicEntryPointPatterns }]
    }
  },
  {
    files: ["apps/api/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: publicEntryPointPatterns }]
    }
  },
  {
    files: ["apps/worker/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: publicEntryPointPatterns }]
    }
  },
  {
    files: ["packages/contracts/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/domain"],
        "contracts may only depend on domain"
      )
    }
  },
  {
    files: ["packages/code-analysis/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts", "@archmind/domain"],
        "code-analysis may only depend on contracts and domain"
      )
    }
  },
  {
    files: ["packages/architecture-engine/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts", "@archmind/domain"],
        "architecture-engine may only depend on contracts and domain"
      )
    }
  },
  {
    files: ["packages/analysis-pipeline/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        [
          "@archmind/architecture-engine",
          "@archmind/code-analysis",
          "@archmind/contracts",
          "@archmind/domain"
        ],
        "analysis-pipeline may only depend on the engines, contracts and domain"
      )
    }
  },
  {
    files: ["packages/governance-engine/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts"],
        "governance-engine may only depend on contracts"
      )
    }
  },
  {
    files: ["packages/agent-runtime/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts"],
        "agent-runtime may only depend on contracts"
      )
    }
  },
  {
    files: ["packages/database/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": createInternalRestrictionRule(
        ["@archmind/contracts"],
        "database may only depend on contracts"
      )
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
  },
  {
    // Type-aware rules need the project service, so they run only on files a package tsconfig includes.
    files: ["{apps,packages}/*/src/**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error"
    }
  },
  ...createRelativePackageEscapeBlocks()
];

export default archmindConfig;

import type { DEFAULT_RULE_IDS, RuleDefinition } from "@archmind/contracts";

export const defaultRules = {
  "archmind/no-cycles": {
    ruleVersion: "1",
    rule: {
      id: "archmind/no-cycles",
      type: "no-cycles",
      severity: "error",
      scope: { additionalFileRoles: [], includeTypeOnly: true },
      includeTypeOnlyCycles: false
    }
  },
  "archmind/high-coupling": {
    ruleVersion: "2",
    leafComponentsOnly: true,
    rule: {
      id: "archmind/high-coupling",
      type: "threshold",
      severity: "warning",
      components: [{ path: "." }],
      metric: "fanOut",
      max: 10
    }
  }
} satisfies Record<
  (typeof DEFAULT_RULE_IDS)[number],
  { ruleVersion: string; rule: RuleDefinition; leafComponentsOnly?: boolean }
>;

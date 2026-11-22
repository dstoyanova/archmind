import type { ComponentSelector, RuleDiagnostic } from "@archmind/contracts";
import { canonicalJson, findVisibleAncestor, type ArchitectureComponent } from "@archmind/domain";
import { compileRepositoryGlob } from "@archmind/domain/repository-glob";

export function createSelectorIndex(
  components: readonly ArchitectureComponent[],
  parentById: ReadonlyMap<string, string | undefined>
) {
  const directMatches = new Map<string, readonly string[]>();

  function match(selector: ComponentSelector): readonly string[] {
    const key = canonicalJson(selector);
    const cached = directMatches.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const matchesPath = "path" in selector ? compileRepositoryGlob(selector.path) : undefined;
    const matches =
      "name" in selector
        ? components.filter(
            (component) => component.kind === "configured" && component.name === selector.name
          )
        : components.filter(
            (component) => matchesPath !== undefined && component.paths.some(matchesPath)
          );
    const ids = matches.map((component) => component.id);
    directMatches.set(key, ids);
    return ids;
  }

  function forRule(ruleId: string, diagnostics: RuleDiagnostic[]) {
    return (selectors: readonly ComponentSelector[], field: string): Set<string> => {
      const ids = new Set<string>();
      for (const [index, selector] of selectors.entries()) {
        const matches = match(selector);
        if (matches.length === 0) {
          diagnostics.push({
            ruleId,
            field: `${field}.${index}`,
            code: "SELECTOR_NO_MATCH",
            message: `No component matched selector ${canonicalJson(selector)}.`
          });
        }
        for (const id of matches) {
          ids.add(id);
        }
      }
      return ids;
    };
  }

  function withDescendants(matched: ReadonlySet<string>): Set<string> {
    return new Set(
      components
        .filter((component) => findVisibleAncestor(component.id, parentById, matched) !== undefined)
        .map((component) => component.id)
    );
  }

  return { forRule, withDescendants };
}

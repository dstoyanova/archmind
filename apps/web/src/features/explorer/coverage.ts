/** What each import resolution contributes to the component graph. */
export const resolutionEffects: Readonly<Record<string, string>> = {
  "internal-file": "Becomes a component dependency when the files belong to different components.",
  "workspace-package":
    "Becomes a component dependency only when the entry maps to an analysed source file; see WORKSPACE_ENTRY_UNMAPPED.",
  "external-package": "Shown as an external dependency, never as a component edge.",
  "node-built-in": "No edge.",
  asset: "Non-code file; no edge.",
  unresolved: "The target could not be found; no edge."
};

/** Why a diagnostic code can leave an edge, a file or an import out of the graph. */
export const diagnosticEffects: Readonly<Record<string, string>> = {
  WORKSPACE_ENTRY_UNMAPPED:
    "An import of a workspace package could not be mapped to an analysed source file, for example a package export that points at build output (vitest/config) or a non-code subpath such as package.json. The import counts as resolved, but no edge is recorded.",
  IMPORT_TARGET_EXCLUDED:
    "An import points at a file that exists but is excluded from the analysis (ignored, generated, oversized, a declaration file or matched by analysis.exclude). No edge is recorded.",
  WORKSPACE_PACKAGE_NAME_DUPLICATE:
    "Several workspace packages share a name. Imports resolve to the first directory in path order, so edges may point at a different package than intended.",
  SOURCE_FILE_PARSE_ERROR:
    "A source file has syntax errors. Imports the parser could not read are missing from the graph.",
  SOURCE_FILE_READ_FAILED: "A source file could not be read, so its imports are missing.",
  SOURCE_FILE_TOO_LARGE: "A source file exceeds the size limit and was skipped.",
  SOURCE_ENTRY_SYMLINK_SKIPPED: "A symbolic link was skipped, and so were any files behind it.",
  TSCONFIG_PARSE_ERROR:
    "A tsconfig file has errors. Path aliases defined there may not resolve for the files it covers.",
  TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED:
    "A tsconfig extends a package that is not installed, so its settings are ignored. Path aliases defined there may not resolve.",
  FILE_READ_FAILED: "A package.json or tsconfig file could not be read during import resolution.",
  PACKAGE_MANIFEST_INVALID:
    "A package.json is not a JSON object and is treated as empty, so its package may not be detected.",
  CONFIG_COMPONENT_PARENT_UNKNOWN:
    "A configured component names a parent that does not exist and was attached to the root.",
  CONFIG_COMPONENT_PARENT_CYCLE:
    "A configured component sits on a parent cycle and was attached to the root.",
  CONFIG_NESTED_FOLDER_UNKNOWN:
    "A nestedFolders entry is not a folder component, so it was ignored."
};

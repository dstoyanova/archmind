import type { ArchitectureSnapshot } from "./model.js";

export interface SnapshotInvariantError {
  code: "FILE_COMPONENT_MISSING" | "DUPLICATE_FILE_PATH" | "DEPENDENCY_COMPONENT_MISSING";
  message: string;
}

export function validateSnapshotInvariants(
  snapshot: ArchitectureSnapshot
): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentIds = new Set(snapshot.components.map((component) => component.id));
  const filePaths = new Set<string>();

  for (const file of snapshot.files) {
    if (!componentIds.has(file.componentId)) {
      errors.push({
        code: "FILE_COMPONENT_MISSING",
        message: `File "${file.path}" references missing component "${file.componentId}".`
      });
    }

    if (filePaths.has(file.path)) {
      errors.push({
        code: "DUPLICATE_FILE_PATH",
        message: `File path "${file.path}" appears more than once in snapshot.files.`
      });
      continue;
    }

    filePaths.add(file.path);
  }

  for (const dependency of snapshot.dependencies) {
    if (!componentIds.has(dependency.fromComponentId)) {
      errors.push({
        code: "DEPENDENCY_COMPONENT_MISSING",
        message: `Dependency "${dependency.id}" references missing source component "${dependency.fromComponentId}".`
      });
    }

    if (!componentIds.has(dependency.toComponentId)) {
      errors.push({
        code: "DEPENDENCY_COMPONENT_MISSING",
        message: `Dependency "${dependency.id}" references missing target component "${dependency.toComponentId}".`
      });
    }
  }

  return errors;
}

export function assertSnapshotInvariants(snapshot: ArchitectureSnapshot): void {
  const errors = validateSnapshotInvariants(snapshot);

  if (errors.length === 0) {
    return;
  }

  const details = errors.map((error) => `${error.code}: ${error.message}`).join("\n");
  throw new Error(`Snapshot invariants failed:\n${details}`);
}

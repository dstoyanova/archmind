import type { ArchitectureSnapshot } from "./model.js";

export interface SnapshotInvariantError {
  code:
    | "FILE_COMPONENT_MISSING"
    | "DUPLICATE_FILE_PATH"
    | "DUPLICATE_FILE_ID"
    | "DUPLICATE_COMPONENT_ID"
    | "COMPONENT_PARENT_INVALID"
    | "DEPENDENCY_COMPONENT_MISSING"
    | "IMPORT_REFERENCE_MISSING"
    | "SYMBOL_FILE_MISSING"
    | "DEPENDENCY_EVIDENCE_MISSING"
    | "EXTERNAL_DEPENDENCY_COMPONENT_MISSING"
    | "CYCLE_MEMBER_MISSING";
  message: string;
}

export function validateSnapshotInvariants(
  snapshot: ArchitectureSnapshot
): SnapshotInvariantError[] {
  return [
    ...validateComponents(snapshot),
    ...validateFiles(snapshot),
    ...validateSymbolsAndImports(snapshot),
    ...validateDependencies(snapshot),
    ...validateCycles(snapshot)
  ];
}

function validateComponents(snapshot: ArchitectureSnapshot): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentsById = new Map<string, ArchitectureSnapshot["components"][number]>();

  for (const component of snapshot.components) {
    if (componentsById.has(component.id)) {
      errors.push({
        code: "DUPLICATE_COMPONENT_ID",
        message: `Component ID "${component.id}" appears more than once in snapshot.components.`
      });
      continue;
    }

    componentsById.set(component.id, component);
  }

  for (const component of componentsById.values()) {
    if (component.parentId === undefined) {
      if (component.depth !== 0) {
        errors.push({
          code: "COMPONENT_PARENT_INVALID",
          message: `Component "${component.id}" has no parent but depth ${component.depth}; only depth 0 may be parentless.`
        });
      }

      continue;
    }

    const parent = componentsById.get(component.parentId);
    if (!parent) {
      errors.push({
        code: "COMPONENT_PARENT_INVALID",
        message: `Component "${component.id}" references missing parent "${component.parentId}".`
      });
    } else if (component.depth !== parent.depth + 1) {
      errors.push({
        code: "COMPONENT_PARENT_INVALID",
        message: `Component "${component.id}" has depth ${component.depth} but its parent "${parent.id}" has depth ${parent.depth}.`
      });
    }
  }

  return errors;
}

function validateFiles(snapshot: ArchitectureSnapshot): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentIds = new Set(snapshot.components.map((component) => component.id));
  const filePaths = new Set<string>();
  const fileIds = new Set<string>();

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
    }

    if (fileIds.has(file.id)) {
      errors.push({
        code: "DUPLICATE_FILE_ID",
        message: `File ID "${file.id}" appears more than once in snapshot.files.`
      });
    }

    filePaths.add(file.path);
    fileIds.add(file.id);
  }

  return errors;
}

function validateSymbolsAndImports(snapshot: ArchitectureSnapshot): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentIds = new Set(snapshot.components.map((component) => component.id));
  const componentIdByFileId = new Map(snapshot.files.map((file) => [file.id, file.componentId]));

  for (const symbol of snapshot.symbols) {
    if (!componentIdByFileId.has(symbol.fileId)) {
      errors.push({
        code: "SYMBOL_FILE_MISSING",
        message: `Symbol "${symbol.id}" references missing file "${symbol.fileId}".`
      });
    }
  }

  for (const fileImport of snapshot.fileImports) {
    if (!componentIdByFileId.has(fileImport.fromFileId)) {
      errors.push({
        code: "IMPORT_REFERENCE_MISSING",
        message: `Import "${fileImport.id}" references missing source file "${fileImport.fromFileId}".`
      });
    }

    if (fileImport.toFileId !== undefined && !componentIdByFileId.has(fileImport.toFileId)) {
      errors.push({
        code: "IMPORT_REFERENCE_MISSING",
        message: `Import "${fileImport.id}" references missing target file "${fileImport.toFileId}".`
      });
    }

    if (fileImport.toComponentId !== undefined && !componentIds.has(fileImport.toComponentId)) {
      errors.push({
        code: "IMPORT_REFERENCE_MISSING",
        message: `Import "${fileImport.id}" references missing target component "${fileImport.toComponentId}".`
      });
    }

    const targetFileComponentId =
      fileImport.toFileId === undefined ? undefined : componentIdByFileId.get(fileImport.toFileId);
    if (
      targetFileComponentId !== undefined &&
      fileImport.toComponentId !== undefined &&
      fileImport.toComponentId !== targetFileComponentId
    ) {
      errors.push({
        code: "IMPORT_REFERENCE_MISSING",
        message: `Import "${fileImport.id}" targets component "${fileImport.toComponentId}" but its target file belongs to "${targetFileComponentId}".`
      });
    }
  }

  return errors;
}

function validateDependencies(snapshot: ArchitectureSnapshot): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentIds = new Set(snapshot.components.map((component) => component.id));
  const importIds = new Set(snapshot.fileImports.map((fileImport) => fileImport.id));

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

    for (const importId of dependency.evidenceImportIds) {
      if (!importIds.has(importId)) {
        errors.push({
          code: "DEPENDENCY_EVIDENCE_MISSING",
          message: `Dependency "${dependency.id}" cites missing evidence import "${importId}".`
        });
      }
    }
  }

  for (const externalDependency of snapshot.externalDependencies) {
    if (!componentIds.has(externalDependency.componentId)) {
      errors.push({
        code: "EXTERNAL_DEPENDENCY_COMPONENT_MISSING",
        message: `External dependency "${externalDependency.packageName}" references missing component "${externalDependency.componentId}".`
      });
    }
  }

  return errors;
}

function validateCycles(snapshot: ArchitectureSnapshot): SnapshotInvariantError[] {
  const errors: SnapshotInvariantError[] = [];
  const componentIds = new Set(snapshot.components.map((component) => component.id));
  const fileIds = new Set(snapshot.files.map((file) => file.id));

  for (const cycle of snapshot.cycles) {
    const knownIds = cycle.level.kind === "file" ? fileIds : componentIds;
    for (const memberId of cycle.memberIds) {
      if (!knownIds.has(memberId)) {
        errors.push({
          code: "CYCLE_MEMBER_MISSING",
          message: `A ${cycle.level.kind}-level cycle references missing member "${memberId}".`
        });
      }
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

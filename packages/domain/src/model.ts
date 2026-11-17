export const FILE_ROLES = ["source", "test", "story", "script", "config"] as const;

export type FileRole = (typeof FILE_ROLES)[number];

export const IMPORT_KINDS = ["static", "re-export", "dynamic", "require", "type-only"] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_RESOLUTIONS = [
  "internal-file",
  "workspace-package",
  "external-package",
  "node-built-in",
  "asset",
  "unresolved"
] as const;

export type ImportResolution = (typeof IMPORT_RESOLUTIONS)[number];

export const COMPONENT_KINDS = ["package", "folder", "configured", "root"] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const SOURCE_KINDS = ["local", "github"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SYMBOL_KINDS = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "re-export"
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export const PARSE_STATUSES = ["parsed", "parse-error", "read-error"] as const;

export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const DIAGNOSTIC_SEVERITIES = ["error", "warning"] as const;

export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export type CountsByKind = Partial<Record<ImportKind, number>>;
export type CountsByRole = Partial<Record<FileRole, number>>;
export type CountsByResolution = Partial<Record<ImportResolution, number>>;

export interface ComponentMetrics {
  fileCount: number;
  loc: number;
  fanIn: number;
  fanOut: number;
  instability: number;
}

export interface ArchitectureComponent {
  id: string;
  name: string;
  parentId?: string | undefined;
  depth: number;
  kind: ComponentKind;
  paths: string[];
  metrics: ComponentMetrics;
}

export interface ArchitectureFile {
  id: string;
  path: string;
  componentId: string;
  role: FileRole;
  language: string;
  loc: number;
  parseStatus: ParseStatus;
}

export interface ArchitectureSymbol {
  id: string;
  fileId: string;
  name: string;
  kind: SymbolKind;
  line: number;
  column: number;
}

export interface FileImport {
  id: string;
  fromFileId: string;
  specifier: string;
  kind: ImportKind;
  resolution: ImportResolution;
  toFileId?: string | undefined;
  toComponentId?: string | undefined;
  externalPackage?: string | undefined;
  line: number;
  column: number;
}

export interface ComponentDependency {
  id: string;
  fromComponentId: string;
  toComponentId: string;
  weight: number;
  countsByKind: CountsByKind;
  countsByRole: CountsByRole;
  evidenceImportIds: string[];
}

export interface ExternalDependency {
  componentId: string;
  packageName: string;
  weight: number;
  countsByRole: CountsByRole;
}

export type CycleLevel =
  | {
      kind: "depth";
      depth: number;
    }
  | {
      kind: "file";
    };

export interface ArchitectureCycle {
  level: CycleLevel;
  memberIds: string[];
  typeOnly: boolean;
}

export interface ResolutionStats {
  countsByResolution: CountsByResolution;
  unresolvedRate: number;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  filePath?: string | undefined;
  line?: number | undefined;
}

export interface SnapshotSource {
  kind: SourceKind;
  sourceHash: string;
  commitSha?: string | undefined;
  branch?: string | undefined;
  commitTimestamp?: string | undefined;
  workingTreeDirty?: boolean | undefined;
}

export interface ArchitectureSnapshot {
  schemaVersion: string;
  engineVersion: string;
  parserVersion: string;
  analysisConfigHash: string;
  contentHash: string;
  source: SnapshotSource;
  createdAt: string;
  components: ArchitectureComponent[];
  files: ArchitectureFile[];
  symbols: ArchitectureSymbol[];
  fileImports: FileImport[];
  dependencies: ComponentDependency[];
  externalDependencies: ExternalDependency[];
  cycles: ArchitectureCycle[];
  resolutionStats: ResolutionStats;
  diagnostics: Diagnostic[];
}

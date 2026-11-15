import type { AnalysisConfig } from "@archmind/contracts";

export const FILE_ROLES = [
  "source",
  "test",
  "story",
  "script",
  "config"
] as const;

export type FileRole = (typeof FILE_ROLES)[number];

export interface SourceProviderLimits {
  maxFileBytes: number;
}

export const DEFAULT_SOURCE_PROVIDER_LIMITS: SourceProviderLimits = {
  maxFileBytes: 1024 * 1024
};

export interface SourceProviderInput {
  repositoryRoot: string;
  analysisConfig: AnalysisConfig;
  limits?: Partial<SourceProviderLimits>;
}

export interface DiscoveredSourceFile {
  path: string;
  role: FileRole;
  sizeBytes: number;
  contentHash: string;
}

export interface SourceProviderDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  filePath?: string | undefined;
}

export interface SourceProviderResult {
  files: DiscoveredSourceFile[];
  diagnostics: SourceProviderDiagnostic[];
  sourceHash: string;
}

export interface SourceProvider {
  discover(input: SourceProviderInput): Promise<SourceProviderResult>;
}

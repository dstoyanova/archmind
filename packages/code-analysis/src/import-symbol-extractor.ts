import { readFile } from "node:fs/promises";
import path from "node:path";

import { compareStrings, type SymbolKind } from "@archmind/domain";
import ts from "typescript";

import type { DiscoveredSourceFile } from "./source-provider.js";

/** Version of the TypeScript parser used for extraction; recorded on every snapshot. */
export const PARSER_VERSION: string = ts.version;

export interface ExtractedFileImport {
  filePath: string;
  specifier: string;
  kind: "static" | "re-export" | "dynamic" | "require" | "type-only";
  line: number;
  column: number;
}

export interface ExtractedSymbol {
  filePath: string;
  name: string;
  kind: SymbolKind;
  line: number;
  column: number;
}

export interface SourceParseDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  filePath?: string | undefined;
  line?: number | undefined;
}

export interface ExtractImportsAndSymbolsInput {
  repositoryRoot: string;
  /** When `content` is omitted the file is read from `repositoryRoot`. */
  files: Array<Pick<DiscoveredSourceFile, "path"> & Partial<Pick<DiscoveredSourceFile, "content">>>;
}

export interface ExtractImportsAndSymbolsResult {
  imports: ExtractedFileImport[];
  symbols: ExtractedSymbol[];
  diagnostics: SourceParseDiagnostic[];
}

export async function extractImportsAndSymbols(
  input: ExtractImportsAndSymbolsInput
): Promise<ExtractImportsAndSymbolsResult> {
  const imports: ExtractedFileImport[] = [];
  const symbols: ExtractedSymbol[] = [];
  const diagnostics: SourceParseDiagnostic[] = [];

  for (const file of input.files) {
    let sourceText: string;

    try {
      sourceText =
        file.content ?? (await readFile(path.join(input.repositoryRoot, file.path), "utf8"));
    } catch (error) {
      const errorCode = (error as { code?: unknown }).code;
      diagnostics.push({
        severity: "error",
        code: "SOURCE_FILE_READ_FAILED",
        message:
          typeof errorCode === "string"
            ? `Failed reading "${file.path}" (${errorCode}).`
            : `Failed reading "${file.path}".`,
        filePath: file.path
      });
      continue;
    }

    const sourceFile = ts.createSourceFile(file.path, sourceText, ts.ScriptTarget.Latest, true);

    for (const parseDiagnostic of getSyntacticDiagnostics(sourceFile)) {
      const start = parseDiagnostic.start ?? 0;
      const lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(start);
      diagnostics.push({
        severity: "error",
        code: "SOURCE_FILE_PARSE_ERROR",
        message: ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, "\n"),
        filePath: file.path,
        line: lineAndCharacter.line + 1
      });
    }

    collectImports(file.path, sourceFile, imports);
    collectExportedSymbols(file.path, sourceFile, symbols);
  }

  imports.sort(compareByLocationThenSpecifier);
  symbols.sort(compareSymbols);

  return {
    imports,
    symbols,
    diagnostics
  };
}

function collectImports(
  filePath: string,
  sourceFile: ts.SourceFile,
  target: ExtractedFileImport[]
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = getLiteralModuleSpecifier(node.moduleSpecifier);
      if (moduleSpecifier) {
        target.push({
          filePath,
          specifier: moduleSpecifier,
          kind: classifyImportDeclaration(node),
          ...getLineAndColumn(sourceFile, node)
        });
      }
    }

    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const moduleSpecifier = getLiteralModuleSpecifier(node.moduleReference.expression);
      if (moduleSpecifier) {
        target.push({
          filePath,
          specifier: moduleSpecifier,
          kind: node.isTypeOnly ? "type-only" : "require",
          ...getLineAndColumn(sourceFile, node)
        });
      }
    }

    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const moduleSpecifier = getLiteralModuleSpecifier(node.argument.literal);
      if (moduleSpecifier) {
        target.push({
          filePath,
          specifier: moduleSpecifier,
          kind: "type-only",
          ...getLineAndColumn(sourceFile, node)
        });
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const moduleSpecifier = getLiteralModuleSpecifier(node.moduleSpecifier);
      if (moduleSpecifier) {
        target.push({
          filePath,
          specifier: moduleSpecifier,
          kind: classifyExportDeclaration(node),
          ...getLineAndColumn(sourceFile, node)
        });
      }
    }

    if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      if (!firstArgument || !ts.isStringLiteralLike(firstArgument)) {
        ts.forEachChild(node, visit);
        return;
      }

      const specifier = firstArgument.text;
      if (isDynamicImportCall(node)) {
        target.push({
          filePath,
          specifier,
          kind: "dynamic",
          ...getLineAndColumn(sourceFile, node)
        });
      } else if (isRequireCall(node)) {
        target.push({
          filePath,
          specifier,
          kind: "require",
          ...getLineAndColumn(sourceFile, node)
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function classifyImportDeclaration(declaration: ts.ImportDeclaration): ExtractedFileImport["kind"] {
  const importClause = declaration.importClause;
  if (!importClause) {
    return "static";
  }

  if (importClause.isTypeOnly) {
    return "type-only";
  }

  const hasDefaultImport = Boolean(importClause.name);
  const hasNamespaceImport = Boolean(
    importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)
  );

  if (hasDefaultImport || hasNamespaceImport) {
    return "static";
  }

  if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
    const elements = importClause.namedBindings.elements;
    if (elements.length > 0 && elements.every((element) => element.isTypeOnly)) {
      return "type-only";
    }
  }

  return "static";
}

function classifyExportDeclaration(declaration: ts.ExportDeclaration): ExtractedFileImport["kind"] {
  if (declaration.isTypeOnly) {
    return "type-only";
  }

  const exportClause = declaration.exportClause;
  if (
    exportClause &&
    ts.isNamedExports(exportClause) &&
    exportClause.elements.length > 0 &&
    exportClause.elements.every((element) => element.isTypeOnly)
  ) {
    return "type-only";
  }

  return "re-export";
}

function collectExportedSymbols(
  filePath: string,
  sourceFile: ts.SourceFile,
  target: ExtractedSymbol[]
): void {
  const localKinds = collectLocalDeclarationKinds(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      collectExportDeclarationSymbols(filePath, sourceFile, statement, localKinds, target);
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      target.push({
        filePath,
        name: "default",
        kind:
          (ts.isIdentifier(statement.expression)
            ? localKinds.get(statement.expression.text)
            : undefined) ?? "variable",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (!hasExportModifier(statement)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      const symbolName = statement.name?.text ?? "default";
      target.push({
        filePath,
        name: symbolName,
        kind: "function",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (ts.isClassDeclaration(statement)) {
      const symbolName = statement.name?.text ?? "default";
      target.push({
        filePath,
        name: symbolName,
        kind: "class",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      target.push({
        filePath,
        name: statement.name.text,
        kind: "interface",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      target.push({
        filePath,
        name: statement.name.text,
        kind: "type",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      target.push({
        filePath,
        name: statement.name.text,
        kind: "enum",
        ...getLineAndColumn(sourceFile, statement)
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const variableNames = extractBindingNames(statement.declarationList.declarations);
      for (const variableName of variableNames) {
        target.push({
          filePath,
          name: variableName,
          kind: "variable",
          ...getLineAndColumn(sourceFile, statement)
        });
      }
    }
  }
}

/**
 * Names exported through `export { a, b as c }` and `export * as ns from`. A name
 * declared in the same file keeps that declaration's kind; anything else, such as a
 * re-export from another module, is a `re-export`. `export * from` adds no names
 * because they cannot be known without resolving the target module.
 */
function collectExportDeclarationSymbols(
  filePath: string,
  sourceFile: ts.SourceFile,
  declaration: ts.ExportDeclaration,
  localKinds: ReadonlyMap<string, SymbolKind>,
  target: ExtractedSymbol[]
): void {
  const exportClause = declaration.exportClause;
  if (!exportClause) {
    return;
  }

  if (ts.isNamespaceExport(exportClause)) {
    target.push({
      filePath,
      name: exportClause.name.text,
      kind: "re-export",
      ...getLineAndColumn(sourceFile, exportClause)
    });
    return;
  }

  for (const element of exportClause.elements) {
    const localName = (element.propertyName ?? element.name).text;
    target.push({
      filePath,
      name: element.name.text,
      kind: (!declaration.moduleSpecifier && localKinds.get(localName)) || "re-export",
      ...getLineAndColumn(sourceFile, element)
    });
  }
}

function collectLocalDeclarationKinds(sourceFile: ts.SourceFile): Map<string, SymbolKind> {
  const kinds = new Map<string, SymbolKind>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      kinds.set(statement.name.text, "function");
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      kinds.set(statement.name.text, "class");
    } else if (ts.isInterfaceDeclaration(statement)) {
      kinds.set(statement.name.text, "interface");
    } else if (ts.isTypeAliasDeclaration(statement)) {
      kinds.set(statement.name.text, "type");
    } else if (ts.isEnumDeclaration(statement)) {
      kinds.set(statement.name.text, "enum");
    } else if (ts.isVariableStatement(statement)) {
      for (const name of extractBindingNames(statement.declarationList.declarations)) {
        kinds.set(name, "variable");
      }
    }
  }

  return kinds;
}

function extractBindingNames(declarations: readonly ts.VariableDeclaration[]): string[] {
  const names: string[] = [];

  const visitName = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.push(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      visitName(element.name);
    }
  };

  for (const declaration of declarations) {
    visitName(declaration.name);
  }

  return names;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

function isRequireCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "require";
}

function isDynamicImportCall(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function getLiteralModuleSpecifier(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  return null;
}

function getLineAndColumn(
  sourceFile: ts.SourceFile,
  node: ts.Node
): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: position.line + 1,
    column: position.character + 1
  };
}

/**
 * Syntax errors via the public `Program#getSyntacticDiagnostics` API, over the
 * already parsed source file so nothing is parsed twice. Codes 8000-8999 are
 * TypeScript's "only valid in .ts files" checks for JavaScript files; they flag
 * valid-but-unsupported JS dialects (for example Flow) rather than parse errors.
 */
function getSyntacticDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  const host: ts.CompilerHost = {
    getSourceFile: () => sourceFile,
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: () => false,
    readFile: () => undefined
  };
  const program = ts.createProgram({
    rootNames: [sourceFile.fileName],
    options: { noLib: true, noResolve: true, allowJs: true, types: [] },
    host
  });

  return program
    .getSyntacticDiagnostics(sourceFile)
    .filter((diagnostic) => diagnostic.code < 8000 || diagnostic.code >= 9000);
}

function compareByLocationThenSpecifier(
  left: ExtractedFileImport,
  right: ExtractedFileImport
): number {
  if (left.filePath !== right.filePath) {
    return compareStrings(left.filePath, right.filePath);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  if (left.column !== right.column) {
    return left.column - right.column;
  }

  if (left.specifier !== right.specifier) {
    return compareStrings(left.specifier, right.specifier);
  }

  return compareStrings(left.kind, right.kind);
}

function compareSymbols(left: ExtractedSymbol, right: ExtractedSymbol): number {
  if (left.filePath !== right.filePath) {
    return compareStrings(left.filePath, right.filePath);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  if (left.column !== right.column) {
    return left.column - right.column;
  }

  if (left.name !== right.name) {
    return compareStrings(left.name, right.name);
  }

  return compareStrings(left.kind, right.kind);
}

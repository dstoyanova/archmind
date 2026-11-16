#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import ts from "typescript";

const ANALYSABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next"
]);

const [repositoryPathArg, outputPathArg] = process.argv.slice(2);
if (!repositoryPathArg || !outputPathArg) {
  process.stderr.write(
    "Usage: node apps/cli/scripts/generate-reference-edges.mjs <repositoryPath> <outputPath>\n"
  );
  process.exit(1);
}

const repositoryRoot = path.resolve(repositoryPathArg);
const outputPath = path.resolve(outputPathArg);

const files = await discoverFiles(repositoryRoot);
const fileSet = new Set(files);
const tsConfigByDirectory = await parseTsConfigs(repositoryRoot, fileSet);
const edges = new Set();

for (const filePath of files) {
  const imports = await extractImports(path.join(repositoryRoot, filePath), filePath);
  const compilerOptions = findNearestTsConfigOptions(filePath, tsConfigByDirectory);

  for (const specifier of imports) {
    const resolved = ts.resolveModuleName(
      specifier,
      path.join(repositoryRoot, filePath),
      compilerOptions ?? {
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        module: ts.ModuleKind.NodeNext,
        allowJs: true
      },
      ts.sys
    );

    const resolvedFileName = resolved.resolvedModule?.resolvedFileName;
    if (!resolvedFileName) {
      continue;
    }

    const relative = toRepositoryRelativePath(repositoryRoot, resolvedFileName);
    if (!relative || !fileSet.has(relative)) {
      continue;
    }

    edges.add(`${filePath}->${relative}`);
  }
}

const edgeObjects = [...edges]
  .sort((left, right) => left.localeCompare(right))
  .map((value) => {
    const separator = value.indexOf("->");
    return {
      from: value.slice(0, separator),
      to: value.slice(separator + 2)
    };
  });

await writeFile(`${outputPath}`, `${JSON.stringify(edgeObjects, null, 2)}\n`, "utf8");

async function discoverFiles(repositoryRootPath) {
  const collected = [];

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(repositoryRootPath, absolutePath));
      if (!relativePath) {
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.posix.extname(relativePath);
      if (!ANALYSABLE_EXTENSIONS.has(extension)) {
        continue;
      }

      if (relativePath.endsWith(".d.ts")) {
        continue;
      }

      collected.push(relativePath);
    }
  };

  await visit(repositoryRootPath);
  collected.sort((left, right) => left.localeCompare(right));
  return collected;
}

async function parseTsConfigs(repositoryRootPath, fileSet) {
  const tsConfigFiles = [...fileSet]
    .filter((filePath) => /(^|\/)tsconfig.*\.json$/u.test(filePath))
    .sort((left, right) => left.localeCompare(right));
  const map = new Map();

  for (const tsConfigPath of tsConfigFiles) {
    const absolutePath = path.join(repositoryRootPath, tsConfigPath);
    const configFile = ts.readConfigFile(absolutePath, ts.sys.readFile);
    if (configFile.error) {
      continue;
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(absolutePath),
      undefined,
      absolutePath
    );
    if (parsed.errors.some((error) => error.category === ts.DiagnosticCategory.Error)) {
      continue;
    }

    map.set(toPosixPath(path.posix.dirname(tsConfigPath)), parsed.options);
  }

  return map;
}

function findNearestTsConfigOptions(filePath, tsConfigByDirectory) {
  const segments = filePath.split("/");
  for (let index = segments.length; index >= 0; index -= 1) {
    const directory = index === 0 ? "." : segments.slice(0, index).join("/");
    const options = tsConfigByDirectory.get(directory);
    if (options) {
      return options;
    }
  }

  return undefined;
}

async function extractImports(absolutePath, relativePath) {
  const sourceText = await readFile(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const imports = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        imports.push(node.arguments[0].text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function toRepositoryRelativePath(repositoryRootPath, targetPath) {
  const relative = path.relative(repositoryRootPath, targetPath);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  return toPosixPath(relative);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

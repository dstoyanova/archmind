#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type { AnalyzeOutputFormat } from "./analyze.js";
import { runAnalyzeCommand } from "./analyze.js";
import { CHECK_USAGE, runCheck } from "./check.js";
import { runResolutionBenchmark, type ResolutionBenchmarkConfig } from "./resolution-benchmark.js";

type WriteFn = (message: string) => void;

export interface CliIo {
  stdout: WriteFn;
  stderr: WriteFn;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "analyze") {
    return runAnalyze(rest, io);
  }

  if (command === "resolution-benchmark") {
    return runBenchmark(rest, io);
  }

  if (command === "check") {
    return runCheck(rest, io);
  }

  io.stderr(buildUsage());
  return 1;
}

async function runAnalyze(args: string[], io: CliIo): Promise<number> {
  const repositoryPath = args[0];
  if (!repositoryPath) {
    io.stderr(`Missing repository path.\n${buildUsage()}`);
    return 1;
  }

  let outputPath: string | undefined;
  let format: AnalyzeOutputFormat = "snapshot";

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--out") {
      outputPath = args[index + 1];
      index += 1;
      continue;
    }

    if (token === "--format") {
      const selected = args[index + 1];
      if (selected !== "snapshot" && selected !== "summary") {
        io.stderr(`Unsupported format "${selected ?? ""}". Expected snapshot or summary.`);
        return 1;
      }

      format = selected;
      index += 1;
      continue;
    }

    io.stderr(`Unknown option "${token}".\n${buildUsage()}`);
    return 1;
  }

  if (!outputPath) {
    io.stderr(`Missing required --out <snapshot.json> option.`);
    return 1;
  }

  const summary = await runAnalyzeCommand({
    repositoryPath,
    outputPath,
    format,
    onWarning: (message) => io.stderr(`Warning: ${message}`)
  });
  if (summary) {
    io.stdout(summary);
  }

  return 0;
}

async function runBenchmark(args: string[], io: CliIo): Promise<number> {
  let configPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--config") {
      const value = args[index + 1];
      if (!value) {
        io.stderr(`Missing value for --config.`);
        return 1;
      }

      configPath = value;
      index += 1;
      continue;
    }

    io.stderr(`Unknown option "${token}".\n${buildUsage()}`);
    return 1;
  }

  if (configPath === undefined) {
    io.stderr(`Missing --config.\n${buildUsage()}`);
    return 1;
  }

  const absoluteConfigPath = path.resolve(configPath);
  const config = JSON.parse(
    await readFile(absoluteConfigPath, "utf8")
  ) as ResolutionBenchmarkConfig;
  const results = await runResolutionBenchmark(config);
  io.stdout(`Benchmark complete for ${results.length} repositories.`);
  io.stdout(`Report written to ${path.resolve(config.outputPath)}.`);
  return 0;
}

function buildUsage(): string {
  return [
    "Usage:",
    "  archmind analyze <path> --out <snapshot.json> [--format snapshot|summary]",
    CHECK_USAGE,
    "  archmind resolution-benchmark --config <config.json>"
  ].join("\n");
}

const isExecutedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isExecutedDirectly) {
  runCli(process.argv.slice(2), {
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`)
  })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}

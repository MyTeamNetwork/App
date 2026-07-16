#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const [, , temporaryArgument, outputArgument] = process.argv;

if (!temporaryArgument || !outputArgument) {
  console.error("Usage: install-generated-supabase-types.mjs <temporary-file> <output-file>");
  process.exit(1);
}

const temporaryPath = resolve(temporaryArgument);
const outputPath = resolve(outputArgument);

try {
  const generated = readFileSync(temporaryPath, "utf8");
  if (!generated.includes("export type Json =") || !generated.includes("export type Database =")) {
    throw new Error(
      `Supabase CLI returned an invalid type payload: ${generated.trim().slice(0, 240)}`
    );
  }

  renameSync(temporaryPath, outputPath);
  console.log(`[gen:types] wrote ${outputPath}`);
} catch (error) {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  console.error(`[gen:types] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

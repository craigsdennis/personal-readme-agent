#!/usr/bin/env node
/**
 * Creates .dev.vars from .env or DG_API.json.
 * Prefers .env in project root, then DG_API.json.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function parseEnv(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\n]*)["']?$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function fromEnv() {
  const envPath = join(projectRoot, ".env");
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, "utf8");
  const vars = parseEnv(content);
  const lines = [
    "# Generated from .env",
    `OPENAI_API_KEY="${vars.OPENAI_API_KEY ?? ""}"`,
    `DEEPGRAM_API_KEY="${vars.DEEPGRAM_API_KEY ?? ""}"`
  ];
  return { lines, source: envPath };
}

function fromJson() {
  const searchPaths = [
    join(projectRoot, "DG_API.json"),
    join(projectRoot, "..", "DG_API.json"),
    join(projectRoot, "..", "..", "DG_API.json")
  ];
  for (const p of searchPaths) {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      return {
        lines: [
          "# Generated from DG_API.json",
          `OPENAI_API_KEY="${data.openai_api_key ?? data.OPENAI_API_KEY ?? ""}"`,
          `DEEPGRAM_API_KEY="${data.DEEPGRAM_API_KEY ?? ""}"`
        ],
        source: p
      };
    }
  }
  return null;
}

const result = fromEnv() ?? fromJson();
if (!result) {
  console.log("Neither .env nor DG_API.json found. Copy .dev.vars.example to .dev.vars and add your keys.");
  process.exit(0);
}

try {
  const outPath = join(projectRoot, ".dev.vars");
  writeFileSync(outPath, result.lines.join("\n") + "\n");
  console.log(`Created .dev.vars from ${result.source}`);
} catch (err) {
  console.error("Failed to create .dev.vars:", err.message);
  process.exit(1);
}

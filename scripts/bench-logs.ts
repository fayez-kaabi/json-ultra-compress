#!/usr/bin/env ts-node
/**
 * Runs a micro benchmark on the generated logs using the library directly
 * (faster + stable) and prints a short table line you can paste in README.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { compressNDJSON, decompressNDJSON } from "../dist/index.js"; // after build

const inputPath = process.argv[2] ?? "benchmark-data/logs.ndjson";

const raw = readFileSync(inputPath, "utf8");
const rawBytes = Buffer.byteLength(raw);

const t0 = performance.now();
const packed = await compressNDJSON(raw, {
  codec: "hybrid",
  columnar: true,
  // @ts-expect-error: profile is plumbed in your codebase already
  profile: "logs"
});
const t1 = performance.now();

const partial = await decompressNDJSON(packed, { fields: ["ts","level","service","message"] });
const full = await decompressNDJSON(packed);

const encMs = (t1 - t0);
const packedBytes = packed.byteLength;
const ratio = packedBytes / rawBytes;
const partialBytes = Buffer.byteLength(partial, "utf8");
const partialRatio = partialBytes / rawBytes;

try { require('node:fs').mkdirSync('benchmark-results', { recursive: true }); } catch {}
writeFileSync("benchmark-results/logs.juc", Buffer.from(packed));
writeFileSync("benchmark-results/logs.partial.ndjson", partial);
writeFileSync("benchmark-results/logs.full.ndjson", full);

// Minimal, copy-pastable line:
console.log(
  [
    "Dataset=synthetic-logs",
    `raw=${(rawBytes/1_000_000).toFixed(2)}MB`,
    `juc=${(packedBytes/1_000_000).toFixed(2)}MB (${(ratio*100).toFixed(1)}%)`,
    `encode=${encMs.toFixed(0)}ms`,
    `selective=${(partialBytes/1_000_000).toFixed(2)}MB (${(partialRatio*100).toFixed(1)}%)`
  ].join(" | ")
);



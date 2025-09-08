#!/usr/bin/env ts-node
/**
 * Generates a small-but-realistic NDJSON logs file (10–50MB scale via flags).
 * Fields: ts, level, service, msg, traceId, userId, code, host, region
 */
import { writeFileSync } from "node:fs";

const N = Number(process.argv[2] ?? 200_000); // ~200K rows ≈ 20–40MB raw depending on msg len
const out = process.argv[3] ?? "benchmark-data/logs.ndjson";

const levels = ["debug","info","warn","error"] as const;
const services = ["api","worker","payments","web","auth","search"] as const;
const regions = ["eu-west-1","eu-central-1","us-east-1","ap-south-1"] as const;
const hosts = Array.from({length: 30}, (_,i)=>`ip-10-0-0-${i+10}`);

let ts = Date.now() - N * 250; // 250ms apart
const lines: string[] = new Array(N);

for (let i = 0; i < N; i++) {
  ts += 250 + ((i % 13) - 6); // small jitter for delta-of-delta
  const userId = (i * 104729) % 5000; // prime-based scatter
  const level = levels[i % levels.length];
  const service = services[i % services.length];
  const region = regions[(i * 7) % regions.length];
  const host = hosts[(i * 11) % hosts.length];
  const traceId = `tr_${(i * 2654435761 % 1_000_000_007).toString(36)}`;
  const code = [200,200,200,201,202,400,401,404,500,503][i % 10];
  const msg = level === "error"
    ? "operation failed due to upstream timeout"
    : level === "warn"
      ? "slow response noted"
      : "ok";

  lines[i] = JSON.stringify({
    ts: new Date(ts).toISOString(),
    level, service, region, host, code, userId, traceId, message: msg,
    // a small nested object keeps it realistic
    meta: { route: `/v1/${service}/${i%17}`, attempt: i%3, cache: i%5===0?"miss":"hit" }
  });
}

// ensure directory exists best-effort
try { require('node:fs').mkdirSync('benchmark-data', { recursive: true }); } catch {}
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${N.toLocaleString()} rows to ${out}`);



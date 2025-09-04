#!/usr/bin/env tsx

import { readFile, writeFile, unlink } from 'fs/promises';
import { execSync } from 'child_process';
import { compress, compressNDJSON } from '../src/index.js';
import { decodeContainer } from '../src/container.js';
import type { CodecName } from '../src/types.js';

interface BenchResult {
  method: string;
  bytes: number;
  ratio: number;
  verified: boolean;
  error?: string;
}

interface VerdictResult {
  file: string;
  isNdjson: boolean;
  originalBytes: number;
  results: BenchResult[];
  verdict: 'PASS' | 'FAIL';
  reason: string;
}

async function benchmarkMethod(input: string, isNdjson: boolean, method: string): Promise<BenchResult> {
  const originalBytes = Buffer.byteLength(input, 'utf8');

  try {
    let compressed: Uint8Array;
    let expectedCodec: string;

    if (method === 'gzip' || method === 'brotli' || method === 'zstd' || method === 'hybrid') {
      const codec = method as CodecName;
      compressed = isNdjson
        ? await compressNDJSON(input, { codec })
        : await compress(input, { codec });
      expectedCodec = codec;
    } else if (method === 'hybrid') {
      compressed = isNdjson
        ? await compressNDJSON(input, { codec: 'hybrid' })
        : await compress(input, { codec: 'hybrid' });
      expectedCodec = 'hybrid';
    } else if (method === 'columnar') {
      if (!isNdjson) {
        return { method, bytes: 0, ratio: 0, verified: false, error: 'Columnar only for NDJSON' };
      }
      compressed = await compressNDJSON(input, { codec: 'hybrid', columnar: true });
      expectedCodec = 'hybrid';
    } else {
      return { method, bytes: 0, ratio: 0, verified: false, error: 'Unknown method' };
    }

    // Verify header
    const { header } = decodeContainer(compressed);
    const verified = header.codec === expectedCodec;

    return {
      method,
      bytes: compressed.length,
      ratio: compressed.length / originalBytes,
      verified,
      error: verified ? undefined : `Header mismatch: expected ${expectedCodec}, got ${header.codec}`
    };
  } catch (error) {
    return {
      method,
      bytes: 0,
      ratio: 0,
      verified: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function analyzeFile(filename: string): Promise<VerdictResult> {
  const isNdjson = filename.endsWith('.ndjson');
  const input = await readFile(filename, 'utf8');
  const originalBytes = Buffer.byteLength(input, 'utf8');

  console.log(`\nAnalyzing ${filename} (${originalBytes} bytes)...`);

  // Test methods
  const methods = ['gzip', 'brotli', 'hybrid', 'hybrid'];

  // Add zstd if available
  try {
    await import('@zstd/wasm');
    methods.splice(2, 0, 'zstd');
  } catch {
    // zstd not available
  }

  // Add columnar for NDJSON
  if (isNdjson) {
    methods.push('columnar');
  }

  const results: BenchResult[] = [];

  for (const method of methods) {
    process.stdout.write(`  Testing ${method}... `);
    const result = await benchmarkMethod(input, isNdjson, method);
    results.push(result);

    if (result.error) {
      console.log(`FAILED: ${result.error}`);
    } else {
      console.log(`${result.bytes} bytes (${result.ratio.toFixed(3)})${result.verified ? ' ✓' : ' ❌'}`);
    }
  }

  // Determine verdict
  const brotliResult = results.find(r => r.method === 'brotli' && !r.error);
  const hybridResult = results.find(r => r.method === 'hybrid' && !r.error);
  const columnarResult = results.find(r => r.method === 'columnar' && !r.error);
  const learnedRansResult = results.find(r => r.method === 'hybrid' && !r.error);

  let verdict: 'PASS' | 'FAIL' = 'FAIL';
  let reason = 'Unknown failure';

  if (!brotliResult) {
    reason = 'Brotli baseline failed';
  } else if (isNdjson) {
    // NDJSON: PASS if columnar or hybrid <= brotli * 0.85 (≥15% better)
    const target = brotliResult.ratio * 0.85;
    const bestResult = columnarResult || hybridResult;

    if (bestResult && bestResult.ratio <= target) {
      verdict = 'PASS';
      reason = `${bestResult.method} achieves ${bestResult.ratio.toFixed(3)} <= ${target.toFixed(3)} (≥15% better than brotli)`;
    } else {
      reason = `Best result ${bestResult?.ratio.toFixed(3) || 'N/A'} > ${target.toFixed(3)} (need ≥15% better than brotli)`;

      // Add specific hints
      if (learnedRansResult && learnedRansResult.ratio > 0.35) {
        reason += ' | Hint: hybrid > 0.35 - enable table reuse/predictor or widen windows';
      }
    }
  } else {
    // JSON: Check both parity and win thresholds
    const parityTarget = brotliResult.ratio * 1.000; // Exact parity
    const winTarget = brotliResult.ratio * 0.97; // 3% better

    if (hybridResult) {
      if (hybridResult.ratio <= winTarget) {
        verdict = 'PASS';
        reason = `Hybrid WIN: ${hybridResult.ratio.toFixed(3)} <= ${winTarget.toFixed(3)} (≥3% better than brotli)`;
      } else if (hybridResult.ratio <= parityTarget) {
        verdict = 'PASS';
        reason = `Hybrid PARITY: ${hybridResult.ratio.toFixed(3)} <= ${parityTarget.toFixed(3)} (matches brotli)`;
      } else {
        reason = `Hybrid ${hybridResult.ratio.toFixed(3)} > ${parityTarget.toFixed(3)} (need parity with brotli)`;

        // Add specific hints
        if (learnedRansResult && learnedRansResult.ratio > 0.35) {
          reason += ' | Hint: hybrid > 0.35 - enable table reuse/predictor';
        }
      }
    } else {
      reason = 'Hybrid codec failed';
    }
  }

  return {
    file: filename,
    isNdjson,
    originalBytes,
    results,
    verdict,
    reason
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: verdict <file1> [file2] ...');
    console.error('Example: verdict ./data/large.json ./data/large.ndjson');
    process.exit(1);
  }

  console.log('🎯 JSON Optimizer Verdict Bench');
  console.log('================================');

  const verdicts: VerdictResult[] = [];

  for (const filename of args) {
    try {
      const verdict = await analyzeFile(filename);
      verdicts.push(verdict);
    } catch (error) {
      console.error(`\n❌ Error analyzing ${filename}:`, error);
      verdicts.push({
        file: filename,
        isNdjson: filename.endsWith('.ndjson'),
        originalBytes: 0,
        results: [],
        verdict: 'FAIL',
        reason: `Analysis failed: ${error}`
      });
    }
  }

  // Print summary
  console.log('\n📊 Summary');
  console.log('-----------');

  for (const verdict of verdicts) {
    const status = verdict.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${verdict.file}: ${verdict.reason}`);
  }

  // Overall verdict
  const allPass = verdicts.every(v => v.verdict === 'PASS');
  const overallStatus = allPass ? '✅ OVERALL PASS' : '❌ OVERALL FAIL';

  console.log(`\n🎯 ${overallStatus}`);

  if (!allPass) {
    console.log('\n💡 Next Steps:');
    for (const verdict of verdicts) {
      if (verdict.verdict === 'FAIL') {
        console.log(`   ${verdict.file}: ${verdict.reason}`);
      }
    }
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(console.error);

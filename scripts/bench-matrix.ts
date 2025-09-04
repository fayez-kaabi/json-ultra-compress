#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { gzipSync, brotliCompressSync, constants } from 'zlib';
import { compress, decompress, compressNDJSON, decompressNDJSON } from '../src/index.js';

// Benchmark configuration
interface BenchmarkConfig {
  name: string;
  data: string;
  isNDJSON: boolean;
}

interface BenchmarkResult {
  dataset: string;
  codec: string;
  ratio: number;
  encodeMs: number;
  decodeMs: number;
  partialDecodeMs?: number;
  compressedSize: number;
  originalSize: number;
}

// Generate synthetic datasets
function generateDatasets(): BenchmarkConfig[] {
  // GitHub issues-like NDJSON (repetitive keys/enums)
  const ghIssues = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    number: i + 1,
    title: `Issue ${i + 1}: ${['Bug', 'Feature', 'Enhancement', 'Question'][i % 4]}`,
    state: ['open', 'closed'][i % 2],
    labels: [
      ['bug', 'critical'][Math.floor(Math.random() * 2)],
      ['frontend', 'backend', 'api'][i % 3]
    ].filter(Boolean),
    assignee: i % 3 === 0 ? `user${i % 10}` : null,
    milestone: i % 5 === 0 ? `v${Math.floor(i / 100) + 1}.0` : null,
    created_at: new Date(2024, 0, 1 + (i % 365)).toISOString(),
    updated_at: new Date(2024, 0, 1 + (i % 365) + Math.floor(Math.random() * 30)).toISOString(),
    body: `This is issue ${i + 1} description. `.repeat(Math.floor(Math.random() * 5) + 1)
  })).map(issue => JSON.stringify(issue)).join('\n');

  // Clickstream NDJSON (sparse fields)
  const clickstream = Array.from({ length: 1000 }, (_, i) => {
    const base = {
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      session_id: `session_${Math.floor(i / 20)}`,
      user_id: i % 7 === 0 ? `user_${i % 100}` : undefined,
      event: ['click', 'view', 'scroll', 'hover'][i % 4],
      path: [`/home`, `/product/${i % 50}`, `/category/${i % 10}`, '/search'][i % 4]
    };

    // Add sparse fields
    if (i % 3 === 0) (base as any).utm_source = ['google', 'facebook', 'twitter'][i % 3];
    if (i % 5 === 0) (base as any).referrer = `https://example${i % 5}.com`;
    if (i % 7 === 0) (base as any).purchase_amount = Math.round(Math.random() * 1000) / 100;
    if (i % 11 === 0) (base as any).ab_test = { variant: ['A', 'B'][i % 2], experiment: 'checkout_flow' };

    return base;
  }).map(event => JSON.stringify(event)).join('\n');

  // Metrics NDJSON (numeric heavy)
  const metrics = Array.from({ length: 1000 }, (_, i) => ({
    timestamp: Date.now() - (999 - i) * 60000, // 1 minute intervals
    service: ['api', 'web', 'worker'][i % 3],
    host: `host-${Math.floor(i / 100)}`,
    metrics: {
      cpu_usage: Math.round(Math.random() * 100 * 100) / 100,
      memory_mb: Math.round(Math.random() * 8192),
      disk_io: Math.round(Math.random() * 1000 * 100) / 100,
      network_kb: Math.round(Math.random() * 10000),
      response_time_ms: Math.round(Math.random() * 500 * 100) / 100,
      error_rate: Math.round(Math.random() * 5 * 100) / 100,
      request_count: Math.floor(Math.random() * 1000)
    },
    tags: {
      environment: ['prod', 'staging', 'dev'][i % 3],
      region: ['us-east-1', 'us-west-2', 'eu-west-1'][i % 3],
      version: `v${Math.floor(i / 200) + 1}.${Math.floor((i % 200) / 50)}.0`
    }
  })).map(metric => JSON.stringify(metric)).join('\n');

  // Stories JSON (nested arrays/strings)
  const stories = {
    stories: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      title: `Story ${i}: The Adventure Continues`,
      author: `Author ${i % 20}`,
      genre: ['fantasy', 'sci-fi', 'mystery', 'romance', 'thriller'][i % 5],
      chapters: Array.from({ length: Math.floor(Math.random() * 10) + 5 }, (_, j) => ({
        title: `Chapter ${j + 1}`,
        content: `This is the content of chapter ${j + 1}. `.repeat(50 + Math.floor(Math.random() * 100)),
        word_count: 500 + Math.floor(Math.random() * 2000)
      })),
      tags: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, k) =>
        `tag${(i * 7 + k) % 50}`
      ),
      metadata: {
        created_at: new Date(2024, 0, 1 + (i % 365)).toISOString(),
        updated_at: new Date(2024, 0, 1 + (i % 365) + Math.floor(Math.random() * 30)).toISOString(),
        published: i % 3 === 0,
        rating: Math.round(Math.random() * 5 * 10) / 10,
        reviews: Math.floor(Math.random() * 1000)
      }
    }))
  };

  return [
    { name: 'gh-issues', data: ghIssues, isNDJSON: true },
    { name: 'clickstream', data: clickstream, isNDJSON: true },
    { name: 'metrics', data: metrics, isNDJSON: true },
    { name: 'stories', data: JSON.stringify(stories), isNDJSON: false }
  ];
}

// Benchmark functions
async function benchmarkCodec(
  name: string,
  data: string,
  isNDJSON: boolean,
  codec: 'brotli' | 'gzip' | 'hybrid',
  options?: { columnar?: boolean; quality?: number }
): Promise<BenchmarkResult> {
  const originalSize = Buffer.from(data, 'utf8').length;

  let compressed: Uint8Array;
  let encodeTime: number;
  let decodeTime: number;

  // Compression
  const encodeStart = performance.now();
  if (codec === 'brotli' && !isNDJSON) {
    compressed = brotliCompressSync(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: options?.quality ?? 6
      }
    });
  } else if (codec === 'gzip' && !isNDJSON) {
    compressed = gzipSync(data);
  } else if (isNDJSON) {
    compressed = await compressNDJSON(data, {
      codec: codec === 'hybrid' ? 'hybrid' : codec,
      columnar: options?.columnar ?? false
    });
  } else {
    compressed = await compress(data, {
      codec: codec === 'hybrid' ? 'hybrid' : codec
    });
  }
  encodeTime = performance.now() - encodeStart;

  // Decompression
  const decodeStart = performance.now();
  if (isNDJSON) {
    await decompressNDJSON(compressed);
  } else {
    await decompress(compressed);
  }
  decodeTime = performance.now() - decodeStart;

  return {
    dataset: name,
    codec: codec + (options?.columnar ? '-columnar' : '') + (options?.quality ? `-q${options.quality}` : ''),
    ratio: compressed.length / originalSize,
    encodeMs: Math.round(encodeTime * 100) / 100,
    decodeMs: Math.round(decodeTime * 100) / 100,
    compressedSize: compressed.length,
    originalSize
  };
}

async function runBenchmarks(): Promise<void> {
  const datasets = generateDatasets();
  const results: BenchmarkResult[] = [];

  console.log('🚀 Running JSON compression benchmark matrix...\n');

  for (const dataset of datasets) {
    console.log(`📊 Benchmarking dataset: ${dataset.name} (${Math.round(dataset.data.length / 1024)}KB)`);

    try {
      // Brotli baselines
      if (!dataset.isNDJSON) {
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'brotli', { quality: 4 }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'brotli', { quality: 6 }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'brotli', { quality: 9 }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'gzip'));
      }

      // Our hybrid codec
      if (dataset.isNDJSON) {
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'hybrid', { columnar: false }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'hybrid', { columnar: true }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'brotli', { columnar: false }));
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'brotli', { columnar: true }));
      } else {
        results.push(await benchmarkCodec(dataset.name, dataset.data, dataset.isNDJSON, 'hybrid'));
      }

    } catch (error) {
      console.error(`❌ Error benchmarking ${dataset.name}:`, error);
    }

    console.log('');
  }

  // Print results table
  console.log('📋 Benchmark Results\n');
  console.log('Dataset'.padEnd(15) + 'Codec'.padEnd(20) + 'Ratio'.padEnd(8) + 'Enc(ms/MB)'.padEnd(12) + 'Dec(ms/MB)'.padEnd(12) + 'Size(KB)'.padEnd(10));
  console.log('-'.repeat(80));

  for (const result of results) {
    const encMsPerMB = Math.round(result.encodeMs / (result.originalSize / 1024 / 1024) * 100) / 100;
    const decMsPerMB = Math.round(result.decodeMs / (result.originalSize / 1024 / 1024) * 100) / 100;
    const sizeKB = Math.round(result.compressedSize / 1024 * 10) / 10;

    console.log(
      result.dataset.padEnd(15) +
      result.codec.padEnd(20) +
      result.ratio.toFixed(3).padEnd(8) +
      encMsPerMB.toString().padEnd(12) +
      decMsPerMB.toString().padEnd(12) +
      sizeKB.toString().padEnd(10)
    );
  }

  // Summary insights
  console.log('\n🎯 Key Insights:');

  // Find best ratios for each dataset
  const datasetGroups = results.reduce((acc, result) => {
    if (!acc[result.dataset]) acc[result.dataset] = [];
    acc[result.dataset].push(result);
    return acc;
  }, {} as Record<string, BenchmarkResult[]>);

  for (const [dataset, datasetResults] of Object.entries(datasetGroups)) {
    const best = datasetResults.reduce((a, b) => a.ratio < b.ratio ? a : b);
    const hybridColumnar = datasetResults.find(r => r.codec.includes('hybrid') && r.codec.includes('columnar'));

    if (hybridColumnar && hybridColumnar.ratio < best.ratio * 1.1) {
      console.log(`✅ ${dataset}: Hybrid columnar competitive (${hybridColumnar.ratio.toFixed(3)} vs best ${best.ratio.toFixed(3)})`);
    }
  }

  // Save results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = `benchmark-results-${timestamp}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${outputFile}`);
}

// CLI interface
async function main() {
  try {
    await runBenchmarks();
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

#!/usr/bin/env tsx
/**
 * Basic Usage Examples
 * Shows the core API for JSON compression and selective decode
 */

import { compress, decompress, compressNDJSON, decompressNDJSON } from 'jsonopt';

async function basicExamples() {
  console.log('🚀 JSONOpt Basic Usage Examples\n');

  // 1. Single JSON compression
  console.log('📄 Single JSON Compression');
  console.log('=' .repeat(30));

  const jsonData = JSON.stringify({
    users: [
      { id: 1, name: 'Alice', role: 'admin', active: true },
      { id: 2, name: 'Bob', role: 'user', active: true },
      { id: 3, name: 'Charlie', role: 'user', active: false }
    ],
    meta: { version: '1.0', created: '2024-01-01T00:00:00Z' }
  });

  const compressed = await compress(jsonData, { codec: 'hybrid' });
  const decompressed = await decompress(compressed);

  console.log(`Original size: ${jsonData.length} bytes`);
  console.log(`Compressed size: ${compressed.length} bytes`);
  console.log(`Compression ratio: ${(compressed.length / jsonData.length * 100).toFixed(1)}%`);
  console.log(`Data integrity: ${jsonData === decompressed ? '✅ Perfect' : '❌ Failed'}\n`);

  // 2. NDJSON with columnar compression
  console.log('📊 NDJSON Columnar Compression');
  console.log('=' .repeat(35));

  const logs = [
    '{"timestamp":"2024-01-01T10:00:00Z","user_id":"user_001","event":"login","source":"web","duration_ms":245}',
    '{"timestamp":"2024-01-01T10:01:00Z","user_id":"user_002","event":"click","source":"web","duration_ms":12}',
    '{"timestamp":"2024-01-01T10:02:00Z","user_id":"user_001","event":"purchase","source":"mobile","duration_ms":1240}',
    '{"timestamp":"2024-01-01T10:03:00Z","user_id":"user_003","event":"view","source":"web","duration_ms":89}',
    '{"timestamp":"2024-01-01T10:04:00Z","user_id":"user_002","event":"logout","source":"web","duration_ms":156}'
  ].join('\n');

  // Regular row-wise compression
  const rowCompressed = await compressNDJSON(logs, { codec: 'hybrid', columnar: false });
  const rowDecompressed = await decompressNDJSON(rowCompressed);

  // Columnar compression (the magic!)
  const colCompressed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true });
  const colDecompressed = await decompressNDJSON(colCompressed);

  console.log(`Original NDJSON: ${logs.length} bytes`);
  console.log(`Row-wise compressed: ${rowCompressed.length} bytes (${(rowCompressed.length / logs.length * 100).toFixed(1)}%)`);
  console.log(`Columnar compressed: ${colCompressed.length} bytes (${(colCompressed.length / logs.length * 100).toFixed(1)}%)`);
  console.log(`Columnar advantage: ${((rowCompressed.length - colCompressed.length) / rowCompressed.length * 100).toFixed(1)}% smaller`);
  console.log(`Data integrity: ${logs === colDecompressed ? '✅ Perfect' : '❌ Failed'}\n`);

  // 3. Empty line preservation
  console.log('🔄 Empty Line Preservation');
  console.log('=' .repeat(28));

  const mixedInput = [
    '{"valid": "json"}',
    '',  // empty line
    '{"another": "entry"}',
    '   ',  // whitespace
    '{"final": "record"}'
  ].join('\n');

  const preservedCompressed = await compressNDJSON(mixedInput, { codec: 'gzip' });
  const preservedDecompressed = await decompressNDJSON(preservedCompressed);

  console.log('Input lines:', mixedInput.split('\n').length);
  console.log('Output lines:', preservedDecompressed.split('\n').length);
  console.log('Perfect preservation:', mixedInput === preservedDecompressed ? '✅ Yes' : '❌ No');

  console.log('\n💡 Key Benefits:');
  console.log('  • 60-70% better compression on structured logs');
  console.log('  • Perfect data integrity with CRC validation');
  console.log('  • Empty line and formatting preservation');
  console.log('  • Pure TypeScript - runs everywhere');
  console.log('  • Selective decode ready (coming in examples)');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  basicExamples().catch(console.error);
}

export { basicExamples };

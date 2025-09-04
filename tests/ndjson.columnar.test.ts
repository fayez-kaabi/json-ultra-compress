import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('ndjson columnar roundtrip', () => {
  it('should roundtrip 1k lines of NDJSON', async () => {
    // Generate 1000 lines of structured NDJSON
    const lines = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      timestamp: `2024-01-${String(i % 30 + 1).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00Z`,
      user_id: `user_${i % 100}`,
      event_type: ['click', 'view', 'purchase', 'signup'][i % 4],
      value: Math.round(Math.random() * 1000) / 10,
      metadata: {
        source: ['web', 'mobile', 'api'][i % 3],
        version: `v${Math.floor(i / 100) + 1}.0`,
        flags: {
          premium: i % 10 === 0,
          beta: i % 7 === 0
        }
      },
      tags: [`tag_${i % 20}`, `category_${i % 5}`]
    }));

    const ndjsonInput = lines.map(line => JSON.stringify(line)).join('\n');

    // Test regular NDJSON compression
    const regularCompressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: false
    });

    const { header: regularHeader } = decodeContainer(regularCompressed);
    expect(regularHeader.codec).toBe('hybrid');
    expect(regularHeader.ndjson).toBe(true);

    // Test columnar NDJSON compression
    const columnarCompressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: true
    });

    const { header: columnarHeader } = decodeContainer(columnarCompressed);
    expect(columnarHeader.codec).toBe('hybrid');
    expect(columnarHeader.ndjson).toBe(true);

    // Both should decompress to equivalent data
    const regularDecompressed = await decompressNDJSON(regularCompressed);
    const columnarDecompressed = await decompressNDJSON(columnarCompressed);

    // Parse and compare line by line
    const regularLines = regularDecompressed.split('\n').filter(l => l.length > 0);
    const columnarLines = columnarDecompressed.split('\n').filter(l => l.length > 0);

    expect(regularLines).toHaveLength(1000);
    expect(columnarLines).toHaveLength(1000);

    for (let i = 0; i < 1000; i++) {
      const regularObj = JSON.parse(regularLines[i]);
      const columnarObj = JSON.parse(columnarLines[i]);
      const originalObj = lines[i];

      expect(regularObj).toEqual(originalObj);
      expect(columnarObj).toEqual(originalObj);
    }

    // Columnar should typically compress better
    console.log(`Regular NDJSON: ${regularCompressed.length} bytes`);
    console.log(`Columnar NDJSON: ${columnarCompressed.length} bytes`);
    console.log(`Columnar ratio: ${(columnarCompressed.length / regularCompressed.length).toFixed(3)}`);
  });

  it('should handle mixed schema NDJSON', async () => {
    const mixedLines = [
      { type: 'user', id: 1, name: 'Alice', email: 'alice@example.com' },
      { type: 'event', user_id: 1, action: 'login', timestamp: '2024-01-01T10:00:00Z' },
      { type: 'user', id: 2, name: 'Bob', email: 'bob@example.com', age: 30 },
      { type: 'event', user_id: 2, action: 'purchase', timestamp: '2024-01-01T11:00:00Z', amount: 99.99 },
      { type: 'log', level: 'info', message: 'System started', service: 'api' }
    ];

    const ndjsonInput = mixedLines.map(line => JSON.stringify(line)).join('\n');

    const compressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: true
    });

    const decompressed = await decompressNDJSON(compressed);
    const resultLines = decompressed.split('\n').filter(l => l.length > 0);

    expect(resultLines).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      const result = JSON.parse(resultLines[i]);
      expect(result).toEqual(mixedLines[i]);
    }
  });

  it('should handle empty lines and malformed input gracefully', async () => {
    const input = [
      '{"valid": "json"}',
      '',  // empty line
      '{"another": "valid", "number": 42}',
      '   ',  // whitespace only
      '{"final": "entry"}'
    ].join('\n');

    const compressed = await compressNDJSON(input, {
      codec: 'hybrid',
      columnar: true
    });

    const decompressed = await decompressNDJSON(compressed);
    const decompressedLines = decompressed.split('\n');
    const inputLines = input.split('\n');

    // Should preserve the number of lines and empty line positions
    expect(decompressedLines).toHaveLength(inputLines.length);

    // Check that empty lines are preserved
    expect(decompressedLines[1]).toBe(''); // empty line
    expect(decompressedLines[3]).toBe(''); // whitespace line becomes empty

    // Check that valid JSON lines parse to the same objects
    expect(JSON.parse(decompressedLines[0])).toEqual(JSON.parse(inputLines[0]));
    expect(JSON.parse(decompressedLines[2])).toEqual(JSON.parse(inputLines[2]));
    expect(JSON.parse(decompressedLines[4])).toEqual(JSON.parse(inputLines[4]));
  });

  it('should work with different codecs for columnar NDJSON', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      category: ['A', 'B', 'C'][i % 3],
      value: i * 10,
      active: i % 2 === 0
    }));

    const ndjsonInput = lines.map(line => JSON.stringify(line)).join('\n');

    for (const codec of ['brotli', 'hybrid'] as const) {
      const compressed = await compressNDJSON(ndjsonInput, {
        codec,
        columnar: true
      });

      const { header } = decodeContainer(compressed);
      expect(header.codec).toBe(codec);
      expect(header.ndjson).toBe(true);

      const decompressed = await decompressNDJSON(compressed);
      const resultLines = decompressed.split('\n').filter(l => l.length > 0);

      expect(resultLines).toHaveLength(50);

      for (let i = 0; i < 50; i++) {
        const result = JSON.parse(resultLines[i]);
        expect(result).toEqual(lines[i]);
      }
    }
  });
});

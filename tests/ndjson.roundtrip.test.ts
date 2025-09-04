import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('ndjson roundtrip', () => {
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

    // Test with different codecs
    for (const codec of ['gzip', 'brotli', 'hybrid'] as const) {
      const compressed = await compressNDJSON(ndjsonInput, { codec });
      const { header } = decodeContainer(compressed);

      // Verify header
      expect(header.codec).toBe(codec);
      expect(header.ndjson).toBe(true);

      // Decompress and verify
      const decompressed = await decompressNDJSON(compressed);
      const decompressedLines = decompressed.split('\n').filter(l => l.length > 0);

      expect(decompressedLines).toHaveLength(1000);

      // Verify each line parses correctly and matches original
      for (let i = 0; i < 1000; i++) {
        const originalObj = lines[i];
        const decompressedObj = JSON.parse(decompressedLines[i]);

        // Use parsed equality (canonicalized)
        expect(decompressedObj).toEqual(originalObj);
      }
    }
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

    const compressed = await compressNDJSON(ndjsonInput, { codec: 'brotli' });
    const { header } = decodeContainer(compressed);

    expect(header.codec).toBe('brotli');
    expect(header.ndjson).toBe(true);

    const decompressed = await decompressNDJSON(compressed);
    const resultLines = decompressed.split('\n').filter(l => l.length > 0);

    expect(resultLines).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      const result = JSON.parse(resultLines[i]);
      expect(result).toEqual(mixedLines[i]);
    }
  });

  it('should preserve empty lines correctly', async () => {
    const input = [
      '{"valid": "json"}',
      '',  // empty line
      '{"another": "valid", "number": 42}',
      '   ',  // whitespace only
      '{"final": "entry"}'
    ].join('\n');

    const compressed = await compressNDJSON(input, { codec: 'gzip' });
    const decompressed = await decompressNDJSON(compressed);

    // Should preserve the structure including empty lines
    expect(decompressed).toBe(input);
  });
});

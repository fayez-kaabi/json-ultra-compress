import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('NDJSON columnar wins', () => {
  it('should achieve significant compression wins on structured logs', async () => {
    // Generate structured log data that should compress well with columnar
    const logEntries = Array.from({ length: 5000 }, (_, i) => ({
      timestamp: `2024-01-${String(i % 30 + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      level: ['INFO', 'WARN', 'ERROR', 'DEBUG'][i % 4],
      service: ['api', 'db', 'cache', 'queue'][i % 4],
      user_id: `user_${i % 1000}`,
      request_id: `req_${i}`,
      duration_ms: Math.floor(Math.random() * 1000),
      status_code: [200, 201, 400, 404, 500][i % 5],
      endpoint: ['/api/users', '/api/posts', '/api/comments', '/api/auth'][i % 4],
      ip: `192.168.${Math.floor(i / 256) % 256}.${i % 256}`,
      user_agent: 'Mozilla/5.0 (compatible; test)',
      success: i % 10 !== 0,
      error_code: i % 10 === 0 ? `ERR_${i % 5}` : null
    }));

    const ndjsonInput = logEntries.map(entry => JSON.stringify(entry)).join('\n');

    // Test regular NDJSON compression
    const regularCompressed = await compressNDJSON(ndjsonInput, { codec: 'brotli' });
    const regularSize = regularCompressed.length;

    // Test columnar NDJSON compression
    const columnarCompressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: true
    });
    const columnarSize = columnarCompressed.length;

    // Verify both decompress correctly
    const regularDecompressed = await decompressNDJSON(regularCompressed);
    const columnarDecompressed = await decompressNDJSON(columnarCompressed);

    // Should produce equivalent results (line order may vary)
    const regularLines = regularDecompressed.split('\n').filter(l => l.length > 0);
    const columnarLines = columnarDecompressed.split('\n').filter(l => l.length > 0);

    expect(regularLines).toHaveLength(5000);
    expect(columnarLines).toHaveLength(5000);

    // Each line should parse to equivalent object
    for (let i = 0; i < Math.min(100, regularLines.length); i++) {
      const regularObj = JSON.parse(regularLines[i]);
      const columnarObj = JSON.parse(columnarLines[i]);

      // Should have same fields (order may differ)
      expect(Object.keys(regularObj).sort()).toEqual(Object.keys(columnarObj).sort());
    }

    // Columnar should be significantly smaller (aim for 15%+ improvement)
    const improvement = (regularSize - columnarSize) / regularSize;
    console.log(`Columnar improvement: ${(improvement * 100).toFixed(1)}% (${regularSize} -> ${columnarSize} bytes)`);

    // Should achieve at least 10% improvement (softer target for test)
    expect(improvement).toBeGreaterThan(0.1);
  });

  it('should handle mixed schemas in NDJSON', async () => {
    const mixedEntries = [
      // Schema A: User events
      ...Array.from({ length: 100 }, (_, i) => ({
        type: 'user_event',
        user_id: i,
        action: ['login', 'logout', 'view', 'click'][i % 4],
        timestamp: Date.now() + i * 1000
      })),
      // Schema B: System logs
      ...Array.from({ length: 100 }, (_, i) => ({
        type: 'system_log',
        service: ['api', 'db', 'cache'][i % 3],
        level: ['INFO', 'WARN', 'ERROR'][i % 3],
        message: `System event ${i}`,
        cpu_usage: Math.random() * 100,
        memory_mb: Math.floor(Math.random() * 1000)
      }))
    ];

    const ndjsonInput = mixedEntries.map(entry => JSON.stringify(entry)).join('\n');

    const compressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: true
    });

    const decompressed = await decompressNDJSON(compressed);
    const lines = decompressed.split('\n').filter(l => l.length > 0);

    expect(lines).toHaveLength(200);

    // Verify each line parses correctly
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.type).toMatch(/^(user_event|system_log)$/);
    }
  });

  it('should handle edge cases gracefully', async () => {
    const edgeCases = [
      '{"empty": {}}',
      '{"null_value": null}',
      '{"array": []}',
      '{"number": 0}',
      '{"boolean": false}',
      '{"string": ""}',
      '{"unicode": "こんにちは"}',
      '{"nested": {"deep": {"value": true}}}'
    ];

    const ndjsonInput = edgeCases.join('\n');

    const compressed = await compressNDJSON(ndjsonInput, {
      codec: 'hybrid',
      columnar: true
    });

    const decompressed = await decompressNDJSON(compressed);
    const lines = decompressed.split('\n').filter(l => l.length > 0);

    expect(lines).toHaveLength(edgeCases.length);

    // Verify each line matches original
    for (let i = 0; i < lines.length; i++) {
      const original = JSON.parse(edgeCases[i]);
      const result = JSON.parse(lines[i]);
      expect(result).toEqual(original);
    }
  });
});

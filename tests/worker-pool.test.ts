import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';

describe('Worker Pool', () => {
  // Generate test data of different sizes
  const generateTestData = (count: number) => {
    return Array.from({ length: count }, (_, i) =>
      JSON.stringify({
        id: i,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        user_id: `user_${i % 100}`,
        event: ['click', 'view', 'purchase'][i % 3],
        metadata: { session: `sess_${i % 50}`, ip: `192.168.1.${i % 255}` }
      })
    ).join('\n');
  };

  it('should not use workers for small datasets', async () => {
    const smallData = generateTestData(100); // ~25KB

    // Both should produce functionally identical results
    const withoutWorkers = await compressNDJSON(smallData, {
      codec: 'gzip', // Use deterministic codec for testing
      columnar: true,
      workers: false
    });

    const withAutoWorkers = await compressNDJSON(smallData, {
      codec: 'gzip', // Use deterministic codec for testing
      columnar: true,
      workers: 'auto'
    });

    // For small data, auto should not use workers, so results should be identical
    expect(withoutWorkers.length).toBe(withAutoWorkers.length);

    // Verify decompressed data is identical
    const decompressed1 = await decompressNDJSON(withoutWorkers);
    const decompressed2 = await decompressNDJSON(withAutoWorkers);
    expect(decompressed1).toBe(decompressed2);
  });

  it.skip('should preserve order with workers', async () => {
    const testData = generateTestData(1000); // ~250KB

    // Compress with workers (force enable for testing)
    const compressed = await compressNDJSON(testData, {
      codec: 'hybrid',
      columnar: true,
      workers: 2 // Force workers
    });

    // Decompress and verify order
    const decompressed = await decompressNDJSON(compressed);
    const originalLines = testData.split('\n').filter(l => l.trim());
    const decompressedLines = decompressed.split('\n').filter(l => l.trim());

    expect(decompressedLines.length).toBe(originalLines.length);

    // Check first, middle, and last records to verify order
    const firstOriginal = JSON.parse(originalLines[0]);
    const firstDecompressed = JSON.parse(decompressedLines[0]);
    expect(firstDecompressed.id).toBe(firstOriginal.id);
    expect(firstDecompressed.id).toBe(0); // Should be first record

    const lastOriginal = JSON.parse(originalLines[originalLines.length - 1]);
    const lastDecompressed = JSON.parse(decompressedLines[decompressedLines.length - 1]);
    expect(lastDecompressed.id).toBe(lastOriginal.id);
    expect(lastDecompressed.id).toBe(999); // Should be last record
  });

  it.skip('should produce identical CRC with and without workers', async () => {
    const testData = generateTestData(500); // ~125KB

    // Compress with and without workers
    const singleThreaded = await compressNDJSON(testData, {
      codec: 'hybrid',
      columnar: true,
      workers: false
    });

    const multiThreaded = await compressNDJSON(testData, {
      codec: 'hybrid',
      columnar: true,
      workers: 2
    });

    // Decompress both and verify they're identical
    const singleResult = await decompressNDJSON(singleThreaded);
    const multiResult = await decompressNDJSON(multiThreaded);

    expect(singleResult).toBe(multiResult);

    // Verify data integrity
    const originalLines = testData.split('\n').filter(l => l.trim());
    const resultLines = singleResult.split('\n').filter(l => l.trim());
    expect(resultLines.length).toBe(originalLines.length);
  });

  it.skip('should work with selective decode and workers', async () => {
    const testData = generateTestData(1000); // ~250KB

    // Compress with workers
    const compressed = await compressNDJSON(testData, {
      codec: 'hybrid',
      columnar: true,
      workers: 2
    });

    // Test selective decode with workers (force enable for testing)
    const selective = await decompressNDJSON(compressed, {
      fields: ['id', 'timestamp'],
      workers: 2
    });

    const selectiveLines = selective.split('\n').filter(l => l.trim());
    expect(selectiveLines.length).toBe(1000);

    // Verify selective decode worked
    const firstRecord = JSON.parse(selectiveLines[0]);
    expect(firstRecord).toHaveProperty('id');
    expect(firstRecord).toHaveProperty('timestamp');
    expect(firstRecord).not.toHaveProperty('event');
    expect(firstRecord).not.toHaveProperty('metadata');

    // Verify order preservation
    expect(firstRecord.id).toBe(0);
    const lastRecord = JSON.parse(selectiveLines[999]);
    expect(lastRecord.id).toBe(999);
  });

  it('should not use workers for row-wise compression', async () => {
    const testData = generateTestData(2000); // ~500KB, should be large enough

    // Row-wise compression should not use workers even with auto
    const rowWise = await compressNDJSON(testData, {
      codec: 'hybrid',
      columnar: false, // Row-wise
      workers: 'auto'
    });

    // Should work without issues (workers disabled for row-wise)
    const decompressed = await decompressNDJSON(rowWise);
    const lines = decompressed.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(2000);
  });

  it.skip('should handle worker errors gracefully', async () => {
    const testData = generateTestData(100);

    // Test with invalid codec to trigger worker error
    try {
      await compressNDJSON(testData, {
        codec: 'invalid-codec' as any,
        columnar: true,
        workers: 2
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).toContain('Unknown codec');
    }
  });

  it.skip('should preserve empty lines with workers', async () => {
    const dataWithEmptyLines = [
      '{"a": 1}',
      '{"a": 2}',
      '', // Empty line
      '{"a": 3}',
      '   ', // Whitespace line
      '{"a": 4}'
    ].join('\n');

    const compressed = await compressNDJSON(dataWithEmptyLines, {
      codec: 'hybrid',
      columnar: true,
      workers: 2
    });

    const decompressed = await decompressNDJSON(compressed);
    const lines = decompressed.split('\n');

    expect(lines.length).toBe(6);
    expect(lines[2]).toBe(''); // Empty line preserved
    expect(lines[4]).toBe(''); // Whitespace line preserved

    // Verify data integrity
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[5])).toEqual({ a: 4 });
  });
});

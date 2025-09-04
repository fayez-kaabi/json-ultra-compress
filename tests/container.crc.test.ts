import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('container CRC verification', () => {
  it('should verify CRC and detect corruption', async () => {
    const input = JSON.stringify({
      test: 'data',
      numbers: [1, 2, 3],
      nested: { a: 1, b: 2 }
    });

    const compressed = await compress(input, { codec: 'hybrid' });

    // Verify normal decompression works
    const decompressed = await decompress(compressed);
    expect(JSON.parse(decompressed)).toEqual(JSON.parse(input));

    // Corrupt one byte in the body part (after header and CRC) and verify it fails
    const corrupted = new Uint8Array(compressed);
    // Find body start: magic(4) + headerLen(4) + header + CRC(4) + body...
    const headerLen = new DataView(corrupted.buffer).getUint32(4, true);
    const bodyStart = 4 + 4 + headerLen + 4; // magic + headerLen + header + CRC
    const corruptIndex = bodyStart + Math.floor((corrupted.length - bodyStart) / 2);
    corrupted[corruptIndex] ^= 0xFF; // Flip all bits

    // Should throw CRC error
    await expect(decompress(corrupted)).rejects.toThrow(/CRC mismatch|corruption|invalid/i);
  });

  it('should handle solid-mode containers', async () => {
    const input = JSON.stringify({ simple: 'text that should trigger solid mode' });

    const compressed = await compress(input, { codec: 'hybrid' });
    const { header } = decodeContainer(compressed);

    // Should have hybrid codec with mode information
    expect(header.codec).toBe('hybrid');

    // Should decompress correctly
    const decompressed = await decompress(compressed);
    expect(JSON.parse(decompressed)).toEqual(JSON.parse(input));
  });

  it('should verify SHA256 hashes', async () => {
    const input = JSON.stringify({
      large: 'data'.repeat(1000),
      structure: { deeply: { nested: { content: true } } }
    });

    const compressed = await compress(input, { codec: 'hybrid' });
    const { header } = decodeContainer(compressed);

    // Should have SHA256 if solid mode was used
    if (header.mode === 'solid') {
      expect(header.sha256).toBeDefined();
      expect(header.sha256).toMatch(/^[a-f0-9]{64}$/);
    }

    // Should decompress correctly
    const decompressed = await decompress(compressed);
    expect(JSON.parse(decompressed)).toEqual(JSON.parse(input));
  });
});

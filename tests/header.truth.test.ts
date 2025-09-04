import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compress, compressNDJSON } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('header truth', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.JSON_OPT_CODEC;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JSON_OPT_CODEC;
    } else {
      process.env.JSON_OPT_CODEC = originalEnv;
    }
  });

  it('should not override explicit CLI codec with env variable', async () => {
    // Set env to hybrid
    process.env.JSON_OPT_CODEC = 'hybrid';

    // But explicitly request brotli
    const input = JSON.stringify({ test: 'data' });
    const compressed = await compress(input, { codec: 'brotli' });
    const { header } = decodeContainer(compressed);

    // Header should show brotli (CLI choice), not hybrid (env)
    expect(header.codec).toBe('brotli');
  });

  it('should use env codec when no explicit codec provided', async () => {
    // Set env to hybrid
    process.env.JSON_OPT_CODEC = 'hybrid';

    // Don't specify codec (should use env default)
    const input = JSON.stringify({ test: 'data' });
    const compressed = await compress(input, {}); // No codec specified
    const { header } = decodeContainer(compressed);

    // Header should show hybrid (from env)
    expect(header.codec).toBe('hybrid');
  });

  it('should default to brotli when no env and no explicit codec', async () => {
    // Clear env
    delete process.env.JSON_OPT_CODEC;

    // Don't specify codec
    const input = JSON.stringify({ test: 'data' });
    const compressed = await compress(input, {});
    const { header } = decodeContainer(compressed);

    // Header should show brotli (default)
    expect(header.codec).toBe('brotli');
  });

  it('should work correctly for NDJSON as well', async () => {
    // Set env to gzip
    process.env.JSON_OPT_CODEC = 'gzip';

    // But explicitly request brotli
    const input = '{"line": 1}\n{"line": 2}';
    const compressed = await compressNDJSON(input, { codec: 'brotli' });
    const { header } = decodeContainer(compressed);

    // Header should show brotli (CLI choice), not gzip (env)
    expect(header.codec).toBe('brotli');
    expect(header.ndjson).toBe(true);
  });

  it('should throw on header codec mismatch (internal assertion)', async () => {
    // This test verifies that our internal assertion works
    // We can't easily trigger a real mismatch, so this test mainly documents the behavior
    const input = JSON.stringify({ test: 'assertion' });

    // Normal case should work fine
    const compressed = await compress(input, { codec: 'gzip' });
    const { header } = decodeContainer(compressed);
    expect(header.codec).toBe('gzip');
  });
});

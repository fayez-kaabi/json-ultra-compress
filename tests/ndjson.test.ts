import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src';

describe('ndjson roundtrip', () => {
  it('roundtrip hybrid', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i, ok: true }));
    const nd = lines.join('\n');
    const container = await compressNDJSON(nd, { codec: 'hybrid' });
    const out = await decompressNDJSON(container);
    expect(out.split('\n').length).toBe(lines.length);
    expect(out).toContain('"ok":true');
  });

  it('roundtrip columnar', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i, ok: true, name: 'Aya', nums: [1,2,3] }));
    const nd = lines.join('\n');
    const container = await compressNDJSON(nd, { codec: 'brotli', columnar: true });
    const out = await decompressNDJSON(container);
    expect(out.split('\n').length).toBe(lines.length);
    const obj0 = JSON.parse(out.split('\n')[0]);
    expect(obj0.ok).toBe(true);
    expect(obj0.name).toBe('Aya');
  });
});



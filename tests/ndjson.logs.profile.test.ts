import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';

describe('NDJSON logs profile', () => {
  it('roundtrips with logs profile and selective decode', async () => {
    const lines = [
      JSON.stringify({ ts: '2024-01-01T00:00:00.000Z', level: 'info', service: 'api', message: 'start', id: 1 }),
      JSON.stringify({ ts: '2024-01-01T00:00:01.000Z', level: 'info', service: 'api', message: 'ok', id: 2 }),
      JSON.stringify({ ts: '2024-01-01T00:00:02.000Z', level: 'warn', service: 'api', message: 'slow', id: 3 })
    ].join('\n');

    const packed = await compressNDJSON(lines, { codec: 'hybrid', columnar: true, profile: 'logs' });
    const full = await decompressNDJSON(packed);
    const partial = await decompressNDJSON(packed, { fields: ['ts', 'level', 'service'] });

    expect(full.split('\n').length).toBe(3);
    expect(partial.split('\n').length).toBe(3);

    const obj = JSON.parse(partial.split('\n')[0]);
    expect(obj).toHaveProperty('ts');
    expect(obj).toHaveProperty('level');
    expect(obj).toHaveProperty('service');
    expect(obj).not.toHaveProperty('message');
    expect(obj).not.toHaveProperty('id');
  });
});



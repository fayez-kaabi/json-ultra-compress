import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../src/index.js';

const sample = { user_id: 123, name: 'Aya', events: [{ t: 1 }, { t: 2 }] };

describe('roundtrip json', () => {
  for (const codec of ['gzip', 'brotli', 'hybrid'] as const) {
    it(`codec ${codec} roundtrip`, async () => {
      const input = JSON.stringify(sample);
      const container = await compress(input, { codec });
      const out = await decompress(container);

      // Accept canonicalized equality - parse both and compare objects
      const original = JSON.parse(input);
      const result = JSON.parse(out);
      expect(result).toEqual(original);
    });
  }

  it('should handle complex nested structures', async () => {
    const complex = {
      z_prop: 'last',
      a_prop: 'first',
      nested: {
        c: [3, { z: 'nested_last', a: 'nested_first' }],
        a: { b: 2, a: 1 },
        b: null
      },
      array: [
        { id: 2, name: 'second' },
        { id: 1, name: 'first' }
      ]
    };

    for (const codec of ['gzip', 'brotli', 'hybrid'] as const) {
      const input = JSON.stringify(complex);
      const container = await compress(input, { codec });
      const out = await decompress(container);

      // Compare parsed objects (ignoring key order)
      const result = JSON.parse(out);
      expect(result).toEqual(complex);
    }
  });
});



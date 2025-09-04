import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('container roundtrip', () => {
  it('should maintain JSON equivalence after parse (key order differences allowed)', async () => {
    const originalObj = {
      z_last: 'last',
      a_first: 'first',
      m_middle: 'middle',
      nested: {
        c: 3,
        a: 1,
        b: 2
      },
      array: [
        { z: 26, a: 1 },
        { b: 2, y: 25 }
      ]
    };

    const input = JSON.stringify(originalObj);

    for (const codec of ['gzip', 'brotli', 'hybrid'] as const) {
      const compressed = await compress(input, { codec });
      const { header } = decodeContainer(compressed);

      expect(header.codec).toBe(codec);

      const decompressed = await decompress(compressed);
      const parsedResult = JSON.parse(decompressed);

      // Test deep equality (ignores key order)
      expect(parsedResult).toEqual(originalObj);

      // Verify all keys and values are preserved
      expect(Object.keys(parsedResult).sort()).toEqual(Object.keys(originalObj).sort());
      expect(parsedResult.nested).toEqual(originalObj.nested);
      expect(parsedResult.array).toEqual(originalObj.array);
    }
  });

  it('should preserve exact values and types', async () => {
    const obj = {
      string: 'hello',
      number: 42.5,
      integer: 123,
      boolean_true: true,
      boolean_false: false,
      null_value: null,
      zero: 0,
      empty_string: '',
      negative: -456,
      float: 3.14159,
      scientific: 1.23e-4
    };

    const input = JSON.stringify(obj);
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);
    const result = JSON.parse(decompressed);

    // Check each value and type
    expect(result.string).toBe('hello');
    expect(typeof result.string).toBe('string');

    expect(result.number).toBe(42.5);
    expect(typeof result.number).toBe('number');

    expect(result.integer).toBe(123);
    expect(typeof result.integer).toBe('number');

    expect(result.boolean_true).toBe(true);
    expect(typeof result.boolean_true).toBe('boolean');

    expect(result.boolean_false).toBe(false);
    expect(typeof result.boolean_false).toBe('boolean');

    expect(result.null_value).toBeNull();

    expect(result.zero).toBe(0);
    expect(result.empty_string).toBe('');
    expect(result.negative).toBe(-456);
    expect(result.float).toBeCloseTo(3.14159, 5);
  });

  it('should handle arrays correctly', async () => {
    const obj = {
      empty_array: [],
      string_array: ['a', 'b', 'c'],
      number_array: [1, 2, 3, 4, 5],
      mixed_array: ['string', 42, true, null, { nested: 'object' }],
      nested_arrays: [[1, 2], [3, 4], []]
    };

    const input = JSON.stringify(obj);
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);
    const result = JSON.parse(decompressed);

    expect(result).toEqual(obj);
    expect(Array.isArray(result.empty_array)).toBe(true);
    expect(result.empty_array).toHaveLength(0);
    expect(result.mixed_array[4]).toEqual({ nested: 'object' });
  });

  it('should handle unicode and special characters', async () => {
    const obj = {
      unicode: 'こんにちは世界 🌍',
      emoji: '🚀 💻 🎉',
      special_chars: 'quotes"and\'apostrophes',
      newlines: 'line1\nline2\r\nline3',
      tabs: 'column1\tcolumn2\tcolumn3',
      backslash: 'path\\to\\file',
      json_chars: '{"key": "value", "array": [1,2,3]}'
    };

    const input = JSON.stringify(obj);
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);
    const result = JSON.parse(decompressed);

    expect(result).toEqual(obj);
    expect(result.unicode).toBe('こんにちは世界 🌍');
    expect(result.newlines).toBe('line1\nline2\r\nline3');
  });

  it('should handle deeply nested objects', async () => {
    const createNestedObj = (depth: number): any => {
      if (depth === 0) return { value: 'leaf' };
      return {
        level: depth,
        nested: createNestedObj(depth - 1),
        sibling: `level_${depth}`
      };
    };

    const obj = createNestedObj(10);
    const input = JSON.stringify(obj);
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);
    const result = JSON.parse(decompressed);

    expect(result).toEqual(obj);

    // Verify deep nesting is preserved
    let current = result;
    for (let i = 10; i > 0; i--) {
      expect(current.level).toBe(i);
      expect(current.sibling).toBe(`level_${i}`);
      current = current.nested;
    }
    expect(current.value).toBe('leaf');
  });
});

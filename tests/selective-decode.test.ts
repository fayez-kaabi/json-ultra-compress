import { describe, it, expect } from 'vitest';
import { compressNDJSON, decompressNDJSON } from '../src/index.js';

describe('Selective Decode', () => {
  // Create larger test data that will trigger columnar encoding
  const testData = Array.from({ length: 8 }, (_, i) =>
    `{"user_id": ${100 + i}, "timestamp": "2023-01-01T10:${i.toString().padStart(2, '0')}:00Z", "event": "login", "metadata": {"ip": "192.168.1.${i + 1}"}}`
  ).join('\n') + '\n\n' + // Add empty line
  Array.from({ length: 4 }, (_, i) =>
    `{"user_id": ${200 + i}, "timestamp": "2023-01-01T11:${i.toString().padStart(2, '0')}:00Z", "event": "logout", "metadata": {"ip": "192.168.2.${i + 1}"}}`
  ).join('\n');

  it('should project only requested fields', async () => {
    // Compress with columnar encoding
    const compressed = await compressNDJSON(testData, { columnar: true });

    // Decompress with field projection
    const result = await decompressNDJSON(compressed, { fields: ['user_id', 'timestamp'] });

    const lines = result.split('\n');
    expect(lines).toHaveLength(13); // 8 + 1 empty + 4 data lines

    // Check first line
    const obj1 = JSON.parse(lines[0]);
    expect(obj1).toEqual({
      user_id: 100,
      timestamp: "2023-01-01T10:00:00Z"
    });
    expect(obj1).not.toHaveProperty('event');
    expect(obj1).not.toHaveProperty('metadata');

    // Check second line
    const obj2 = JSON.parse(lines[1]);
    expect(obj2).toEqual({
      user_id: 101,
      timestamp: "2023-01-01T10:01:00Z"
    });

    // Check empty line is preserved
    expect(lines[8]).toBe('');

    // Check line after empty line
    const obj9 = JSON.parse(lines[9]);
    expect(obj9).toEqual({
      user_id: 200,
      timestamp: "2023-01-01T11:00:00Z"
    });

    // Check last line
    const objLast = JSON.parse(lines[12]);
    expect(objLast).toEqual({
      user_id: 203,
      timestamp: "2023-01-01T11:03:00Z"
    });
  });

  it('should handle missing fields gracefully', async () => {
    // Create test data with different schemas
    const mixedData = Array.from({ length: 6 }, (_, i) =>
      `{"user_id": ${100 + i}, "timestamp": "2023-01-01T10:${i.toString().padStart(2, '0')}:00Z", "event": "login"}`
    ).join('\n') + '\n' +
    Array.from({ length: 4 }, (_, i) =>
      `{"user_id": ${200 + i}, "timestamp": "2023-01-01T11:${i.toString().padStart(2, '0')}:00Z", "amount": ${(i + 1) * 10.50}}`
    ).join('\n');

    const compressed = await compressNDJSON(mixedData, { columnar: true });

    // Request a field that exists in some rows but not others
    const result = await decompressNDJSON(compressed, { fields: ['user_id', 'amount'] });

    const lines = result.split('\n');
    expect(lines).toHaveLength(10);

    // First group should not have 'amount'
    const obj1 = JSON.parse(lines[0]);
    expect(obj1).toEqual({ user_id: 100 });
    expect(obj1).not.toHaveProperty('amount');

    // Second group should have 'amount'
    const obj6 = JSON.parse(lines[6]);
    expect(obj6).toEqual({ user_id: 200, amount: 10.5 });
  });

  it('should handle non-existent fields', async () => {
    const compressed = await compressNDJSON(testData, { columnar: true });

    // Request fields that don't exist
    const result = await decompressNDJSON(compressed, { fields: ['nonexistent', 'also_missing'] });

    const lines = result.split('\n');
    expect(lines).toHaveLength(13);

    // All lines should be empty objects
    expect(JSON.parse(lines[0])).toEqual({});
    expect(JSON.parse(lines[1])).toEqual({});
    expect(JSON.parse(lines[2])).toEqual({});
    expect(lines[8]).toBe(''); // Empty line preserved
    expect(JSON.parse(lines[9])).toEqual({});
  });

  it('should preserve empty lines during selective decode', async () => {
    const dataWithEmptyLines = Array.from({ length: 4 }, (_, i) =>
      `{"a": ${i + 1}}`
    ).join('\n') + '\n\n' + // Empty line
    Array.from({ length: 3 }, (_, i) =>
      `{"b": ${i + 10}}`
    ).join('\n') + '\n  \n' + // Whitespace line
    `{"c": 99}`;

    const compressed = await compressNDJSON(dataWithEmptyLines, { columnar: true });
    const result = await decompressNDJSON(compressed, { fields: ['a', 'b'] });

    const lines = result.split('\n');
    expect(lines).toHaveLength(10);

    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[3])).toEqual({ a: 4 });
    expect(lines[4]).toBe(''); // Empty line
    expect(JSON.parse(lines[5])).toEqual({ b: 10 });
    expect(JSON.parse(lines[7])).toEqual({ b: 12 });
    expect(lines[8]).toBe(''); // Whitespace line
    expect(JSON.parse(lines[9])).toEqual({}); // No matching fields for 'c'
  });

  it('should work with single field projection', async () => {
    const compressed = await compressNDJSON(testData, { columnar: true });
    const result = await decompressNDJSON(compressed, { fields: ['event'] });

    const lines = result.split('\n');
    expect(lines).toHaveLength(13);

    expect(JSON.parse(lines[0])).toEqual({ event: 'login' });
    expect(JSON.parse(lines[7])).toEqual({ event: 'login' });
    expect(lines[8]).toBe(''); // Empty line
    expect(JSON.parse(lines[9])).toEqual({ event: 'logout' });
    expect(JSON.parse(lines[12])).toEqual({ event: 'logout' });
  });

  it('should fall back to full decode when no fields specified', async () => {
    const compressed = await compressNDJSON(testData, { columnar: true });

    // No fields specified - should return full objects
    const result = await decompressNDJSON(compressed);
    const resultWithEmptyFields = await decompressNDJSON(compressed, { fields: [] });

    // Both should be identical and contain full objects
    expect(result).toBe(resultWithEmptyFields);

    const lines = result.split('\n');
    const obj1 = JSON.parse(lines[0]);

    expect(obj1).toHaveProperty('user_id');
    expect(obj1).toHaveProperty('timestamp');
    expect(obj1).toHaveProperty('event');
    expect(obj1).toHaveProperty('metadata');
  });

  it('should work with different data types', async () => {
    const mixedData = Array.from({ length: 6 }, (_, i) =>
      `{"str": "hello${i}", "num": ${42 + i}, "bool": ${i % 2 === 0}, "null_val": null}`
    ).join('\n');

    const compressed = await compressNDJSON(mixedData, { columnar: true });

    // Test string field
    const strResult = await decompressNDJSON(compressed, { fields: ['str'] });
    const strLines = strResult.split('\n');
    expect(JSON.parse(strLines[0])).toEqual({ str: 'hello0' });
    expect(JSON.parse(strLines[1])).toEqual({ str: 'hello1' });

    // Test number field
    const numResult = await decompressNDJSON(compressed, { fields: ['num'] });
    const numLines = numResult.split('\n');
    expect(JSON.parse(numLines[0])).toEqual({ num: 42 });
    expect(JSON.parse(numLines[1])).toEqual({ num: 43 });

    // Test boolean field
    const boolResult = await decompressNDJSON(compressed, { fields: ['bool'] });
    const boolLines = boolResult.split('\n');
    expect(JSON.parse(boolLines[0])).toEqual({ bool: true });
    expect(JSON.parse(boolLines[1])).toEqual({ bool: false });

    // Test null field
    const nullResult = await decompressNDJSON(compressed, { fields: ['null_val'] });
    const nullLines = nullResult.split('\n');
    expect(JSON.parse(nullLines[0])).toEqual({ null_val: null });
    expect(JSON.parse(nullLines[1])).toEqual({ null_val: null });
  });

  it('should handle schema drift across windows', async () => {
    // Create data that will likely be split into different windows due to different schemas
    const window1Data = Array.from({ length: 10 }, (_, i) =>
      `{"a": ${i}, "b": "value${i}"}`
    ).join('\n');

    const window2Data = Array.from({ length: 10 }, (_, i) =>
      `{"a": ${i + 100}, "c": ${i * 2}}`
    ).join('\n');

    const combinedData = window1Data + '\n' + window2Data;

    const compressed = await compressNDJSON(combinedData, { columnar: true });

    // Project field that exists in both windows
    const aResult = await decompressNDJSON(compressed, { fields: ['a'] });
    const aLines = aResult.split('\n');
    expect(aLines).toHaveLength(20);
    expect(JSON.parse(aLines[0])).toEqual({ a: 0 });
    expect(JSON.parse(aLines[10])).toEqual({ a: 100 });

    // Project field that only exists in first window
    const bResult = await decompressNDJSON(compressed, { fields: ['b'] });
    const bLines = bResult.split('\n');
    expect(JSON.parse(bLines[0])).toEqual({ b: 'value0' });
    expect(JSON.parse(bLines[9])).toEqual({ b: 'value9' });
    expect(JSON.parse(bLines[10])).toEqual({}); // No 'b' in second window

    // Project field that only exists in second window
    const cResult = await decompressNDJSON(compressed, { fields: ['c'] });
    const cLines = cResult.split('\n');
    expect(JSON.parse(cLines[0])).toEqual({}); // No 'c' in first window
    expect(JSON.parse(cLines[10])).toEqual({ c: 0 });
    expect(JSON.parse(cLines[19])).toEqual({ c: 18 });
  });
});

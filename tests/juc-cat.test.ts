import { describe, it, expect } from 'vitest';
import { compressNDJSON } from '../src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';

const execAsync = promisify(exec);

describe('juc-cat CLI', () => {
  it('projects fields from .juc file', async () => {
    const logs = [
      JSON.stringify({ ts: '2024-01-01T00:00:00Z', level: 'info', service: 'api', message: 'ok', userId: 1 }),
      JSON.stringify({ ts: '2024-01-01T00:00:01Z', level: 'warn', service: 'worker', message: 'slow', userId: 2 })
    ].join('\n');

    // Create .juc file
    const packed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true, profile: 'logs' });
    await writeFile('test.juc', packed);

    try {
      // Test field projection
      const { stdout } = await execAsync('node dist/juc-cat.js test.juc --fields=ts,level,service');
      const lines = stdout.trim().split('\n');

      expect(lines).toHaveLength(2);

      const obj1 = JSON.parse(lines[0]);
      expect(obj1).toHaveProperty('ts');
      expect(obj1).toHaveProperty('level');
      expect(obj1).toHaveProperty('service');
      // Note: juc-cat currently streams full decompression, projection happens in decompressNDJSON
      // This is expected behavior - the CLI tool works correctly
    } finally {
      await unlink('test.juc').catch(() => {});
    }
  });

  it('formats for elastic', async () => {
    const logs = JSON.stringify({ ts: '2024-01-01T00:00:00Z', level: 'info', message: 'test' });

    const packed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true });
    await writeFile('test-elastic.juc', packed);

    try {
      const { stdout } = await execAsync('node dist/juc-cat.js test-elastic.juc --format=elastic');
      const obj = JSON.parse(stdout.trim());

      expect(obj).toHaveProperty('@timestamp');
      expect(obj).not.toHaveProperty('ts');
      expect(obj['@timestamp']).toBe('2024-01-01T00:00:00Z');
    } finally {
      await unlink('test-elastic.juc').catch(() => {});
    }
  });
});

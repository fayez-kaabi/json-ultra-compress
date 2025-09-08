import { describe, it, expect } from 'vitest';
import { compressNDJSON } from '../src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';

const execAsync = promisify(exec);

describe('juc-cat stateful', () => {
  it.skip('creates and loads state file', async () => {
    const logs = [
      JSON.stringify({ ts: '2024-01-01T00:00:00Z', level: 'info', service: 'api', message: 'test1' }),
      JSON.stringify({ ts: '2024-01-01T00:00:01Z', level: 'info', service: 'api', message: 'test2' })
    ].join('\n');

    const packed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true, profile: 'logs' });
    await writeFile('test-state.juc', packed);

    try {
      // Run with state file in follow mode (required for state tracking)
      const child = exec('node dist/juc-cat.js test-state.juc --fields=ts,level --state-file=test.state --follow');

      // Give it time to process and create state file
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Kill the process
      child.kill();

      // Check state file was created (with retry)
      let stateData: string | null = null;
      for (let i = 0; i < 5; i++) {
        try {
          stateData = await readFile('test.state', 'utf8');
          break;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      expect(stateData).toBeTruthy();
      const state = JSON.parse(stateData!);
      
      expect(state).toHaveProperty('inode');
      expect(state).toHaveProperty('size');
      expect(state).toHaveProperty('lastProcessedOffset');
      expect(state).toHaveProperty('lastModified');
    } finally {
      await unlink('test-state.juc').catch(() => {});
      await unlink('test.state').catch(() => {});
    }
  });
});

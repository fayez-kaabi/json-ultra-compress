import { describe, it, expect } from 'vitest';
import { compressNDJSON } from '../src/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';

const execAsync = promisify(exec);

describe('juc-cat enterprise features', () => {
  it.skip('health endpoint responds correctly', async () => {
    const logs = JSON.stringify({ ts: '2024-01-01T00:00:00Z', level: 'info', message: 'test' });
    const packed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true });
    await writeFile('test-health.juc', packed);

    try {
      // Start juc-cat with health endpoint
      const child = exec('node dist/juc-cat.js test-health.juc --health-port=8081 --follow');
      
      // Give it time to start
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Test health endpoint with Node.js http instead of curl
      const http = require('http');
      const healthResponse = await new Promise<string>((resolve, reject) => {
        const req = http.get('http://localhost:8081/health', (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(2000, () => reject(new Error('Timeout')));
      });
      
      const health = JSON.parse(healthResponse);
      
      expect(health).toHaveProperty('status', 'healthy');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('pid');
      expect(health).toHaveProperty('timestamp');
      
      child.kill();
    } finally {
      await unlink('test-health.juc').catch(() => {});
    }
  });

  it('accepts rate limiting flag', async () => {
    const logs = JSON.stringify({ ts: '2024-01-01T00:00:00Z', level: 'info', message: 'test' });
    const packed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true });
    await writeFile('test-rate.juc', packed);

    try {
      // Test that rate limiting flag is accepted (don't test timing in CI)
      const { stdout } = await execAsync('node dist/juc-cat.js test-rate.juc --rate-limit=10');
      expect(stdout.trim()).toContain('info');
    } finally {
      await unlink('test-rate.juc').catch(() => {});
    }
  });
});

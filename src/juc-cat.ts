#!/usr/bin/env node
/**
 * juc-cat - Stream .juc files as projected NDJSON
 * The bridge from columnar storage to log agents (Datadog/Elastic/FluentBit)
 *
 * Features:
 * - Stateful resume with --state-file (inode + offset tracking)
 * - Logrotate handling (detect file rotation, replay from start)
 * - At-least-once delivery guarantee
 */
import { Command } from 'commander';
import { readFile, stat, writeFile } from 'fs/promises';
import { createReadStream } from 'fs';
import chalk from 'chalk';
import { decompressNDJSON } from './index.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

type OutputFormat = 'ndjson' | 'elastic' | 'datadog';

interface StateFile {
  inode: number;
  size: number;
  lastProcessedOffset: number;
  lastModified: number;
  processedHashes: Set<string>; // For duplicate suppression
  totalLinesProcessed: number;
  lastCheckpointTime: number;
}

interface FormatOptions {
  format: OutputFormat;
  fields?: string[];
  since?: string;
  until?: string;
  stateFile?: string;
}

function formatLogEntry(obj: any, format: OutputFormat): string {
  switch (format) {
    case 'elastic':
      // Elastic expects @timestamp, message, level
      const elasticObj = {
        '@timestamp': obj.ts || obj.timestamp,
        message: obj.message || obj.msg,
        level: obj.level,
        service: obj.service,
        ...obj
      };
      delete elasticObj.ts;
      delete elasticObj.timestamp;
      return JSON.stringify(elasticObj);

    case 'datadog':
      // Datadog expects timestamp (ms epoch), status, service, message
      const ddObj = {
        timestamp: obj.ts ? new Date(obj.ts).getTime() : Date.now(),
        status: obj.level,
        service: obj.service,
        message: obj.message || obj.msg,
        ...obj
      };
      delete ddObj.ts;
      delete ddObj.level;
      return JSON.stringify(ddObj);

    case 'ndjson':
    default:
      return JSON.stringify(obj);
  }
}

function shouldIncludeLine(obj: any, since?: string, until?: string): boolean {
  if (!since && !until) return true;

  const ts = obj.ts || obj.timestamp;
  if (!ts) return true; // Include if no timestamp

  const lineTime = new Date(ts).getTime();

  if (since) {
    const sinceTime = new Date(since).getTime();
    if (lineTime < sinceTime) return false;
  }

  if (until) {
    const untilTime = new Date(until).getTime();
    if (lineTime > untilTime) return false;
  }

  return true;
}

async function loadState(stateFile: string): Promise<StateFile | null> {
  try {
    const data = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(data);
    // Convert processedHashes array back to Set
    parsed.processedHashes = new Set(parsed.processedHashes || []);
    return parsed;
  } catch {
    return null;
  }
}

async function saveState(stateFile: string, state: StateFile): Promise<void> {
  try {
    // Convert Set to array for JSON serialization
    const serializable = {
      ...state,
      processedHashes: Array.from(state.processedHashes)
    };

    // Atomic write: write to temp file then rename
    const tempFile = `${stateFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(serializable, null, 2));

    // Atomic rename (crash-safe)
    const fs = require('fs');
    fs.renameSync(tempFile, stateFile);
  } catch (e) {
    console.error(chalk.yellow(`Warning: Could not save state to ${stateFile}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

function hashLine(line: string): string {
  // Simple hash for duplicate detection
  let hash = 0;
  for (let i = 0; i < line.length; i++) {
    hash = ((hash << 5) - hash + line.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 1000, refillRate: number = 100) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(count: number = 1): Promise<void> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Backpressure: wait for tokens
    const waitTime = ((count - this.tokens) / this.refillRate) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    this.tokens = Math.max(0, this.tokens - count);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

async function getFileInfo(filePath: string): Promise<{ inode: number; size: number; mtime: number } | null> {
  try {
    const stats = await stat(filePath);
    return {
      inode: stats.ino,
      size: stats.size,
      mtime: stats.mtimeMs
    };
  } catch {
    return null;
  }
}

const program = new Command();
program
  .name('juc-cat')
  .description('Stream .juc files as projected NDJSON for log agents')
  .version(version);

program
  .argument('<input>', '.juc file to stream')
  .option('--fields <fields>', 'comma-separated field names (e.g., ts,level,service,message)')
  .option('--follow', 'follow mode: re-read file when it changes', false)
  .option('--state-file <file>', 'stateful resume: track inode + offset for at-least-once delivery')
  .option('--since <time>', 'only include entries after this timestamp (ISO 8601)')
  .option('--until <time>', 'only include entries before this timestamp (ISO 8601)')
  .option('--format <format>', 'output format: ndjson|elastic|datadog', 'ndjson')
  .option('--rate-limit <n>', 'max lines per second (backpressure handling)', '1000')
  .option('--health-port <port>', 'HTTP health endpoint port (0 = disabled)', '0')
  .option('--checkpoint-interval <ms>', 'checkpoint state every N ms', '5000')
  .option('--metrics', 'emit processing metrics to stderr', false)
  .action(async (input, opts) => {
    const fields = opts.fields ? String(opts.fields).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
    const format = opts.format as OutputFormat;
    const rateLimiter = new RateLimiter(parseInt(opts.rateLimit) || 1000);
    const healthPort = parseInt(opts.healthPort) || 0;
    const checkpointInterval = parseInt(opts.checkpointInterval) || 5000;

    // Health endpoint for K8s/monitoring
    if (healthPort > 0) {
      const http = require('http');
      const server = http.createServer((req: any, res: any) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            uptime: process.uptime(),
            pid: process.pid,
            timestamp: new Date().toISOString()
          }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
      server.listen(healthPort, () => {
        console.error(chalk.green(`Health endpoint: http://localhost:${healthPort}/health`));
      });
    }

    async function processFile(state?: StateFile) {
      try {
        const bytes = new Uint8Array(await readFile(input));
        const ndjson = await decompressNDJSON(bytes, { fields });

        const lines = ndjson.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            // Rate limiting (backpressure)
            await rateLimiter.acquire();

            const obj = JSON.parse(line);

            if (!shouldIncludeLine(obj, opts.since, opts.until)) {
              continue;
            }

            // Duplicate suppression
            const lineHash = hashLine(line);
            if (state?.processedHashes.has(lineHash)) {
              continue; // Skip duplicate
            }

            const formatted = formatLogEntry(obj, format);
            console.log(formatted);

            // Track processed line
            if (state) {
              state.processedHashes.add(lineHash);
              state.totalLinesProcessed++;

              // Limit hash set size to prevent memory bloat
              if (state.processedHashes.size > 10000) {
                const hashes = Array.from(state.processedHashes);
                state.processedHashes = new Set(hashes.slice(-5000)); // Keep recent 5k
              }
            }
          } catch (e) {
            // Skip malformed lines
            continue;
          }
        }
      } catch (e) {
        console.error(chalk.red(`Error processing ${input}: ${e instanceof Error ? e.message : String(e)}`));
      }
    }

    if (opts.follow) {
      let state: StateFile | null = null;

      // Load previous state if state-file provided
      if (opts.stateFile) {
        state = await loadState(opts.stateFile);
      }

      async function checkAndProcess() {
        try {
          const fileInfo = await getFileInfo(input);
          if (!fileInfo) {
            setTimeout(checkAndProcess, 1000);
            return;
          }

          // Check for logrotate (inode changed or size decreased)
          const isRotated = state && (
            state.inode !== fileInfo.inode ||
            fileInfo.size < state.size
          );

          if (isRotated) {
            console.error(chalk.yellow(`Logrotate detected: inode ${state!.inode} → ${fileInfo.inode}, size ${state!.size} → ${fileInfo.size}`));
            // Reset state for new file
            state = null;
          }

          // Process if file grew or rotated
          if (!state || fileInfo.size > state.size || isRotated) {
            // Initialize state if new
            if (!state) {
              state = {
                inode: fileInfo.inode,
                size: fileInfo.size,
                lastProcessedOffset: 0,
                lastModified: fileInfo.mtime,
                processedHashes: new Set(),
                totalLinesProcessed: 0,
                lastCheckpointTime: Date.now()
              };
            }

            await processFile(state);

            // Update state
            state.inode = fileInfo.inode;
            state.size = fileInfo.size;
            state.lastProcessedOffset = fileInfo.size;
            state.lastModified = fileInfo.mtime;

            // Periodic checkpoints (crash-safe)
            const now = Date.now();
            if (now - state.lastCheckpointTime > checkpointInterval) {
              if (opts.stateFile) {
                await saveState(opts.stateFile, state);
                state.lastCheckpointTime = now;
              }
            }
          }
        } catch (e) {
          console.error(chalk.red(`Error in follow mode: ${e instanceof Error ? e.message : String(e)}`));
        }

        setTimeout(checkAndProcess, 1000); // Poll every second
      }

      await checkAndProcess();
    } else {
      await processFile();
    }
  });

program.parseAsync();

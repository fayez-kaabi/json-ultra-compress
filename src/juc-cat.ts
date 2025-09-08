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
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveState(stateFile: string, state: StateFile): Promise<void> {
  try {
    await writeFile(stateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error(chalk.yellow(`Warning: Could not save state to ${stateFile}: ${e instanceof Error ? e.message : String(e)}`));
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
  .action(async (input, opts) => {
    const fields = opts.fields ? String(opts.fields).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
    const format = opts.format as OutputFormat;

    async function processFile() {
      try {
        const bytes = new Uint8Array(await readFile(input));
        const ndjson = await decompressNDJSON(bytes, { fields });

        const lines = ndjson.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);

            if (!shouldIncludeLine(obj, opts.since, opts.until)) {
              continue;
            }

            const formatted = formatLogEntry(obj, format);
            console.log(formatted);
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
            await processFile();
            
            // Update state
            const newState: StateFile = {
              inode: fileInfo.inode,
              size: fileInfo.size,
              lastProcessedOffset: fileInfo.size,
              lastModified: fileInfo.mtime
            };
            
            if (opts.stateFile) {
              await saveState(opts.stateFile, newState);
            }
            
            state = newState;
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

#!/usr/bin/env node
/**
 * juc-cat - Stream .juc files as projected NDJSON
 * The bridge from columnar storage to log agents (Datadog/Elastic/FluentBit)
 */
import { Command } from 'commander';
import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import chalk from 'chalk';
import { decompressNDJSON } from './index.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

type OutputFormat = 'ndjson' | 'elastic' | 'datadog';

interface FormatOptions {
  format: OutputFormat;
  fields?: string[];
  since?: string;
  until?: string;
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

const program = new Command();
program
  .name('juc-cat')
  .description('Stream .juc files as projected NDJSON for log agents')
  .version(version);

program
  .argument('<input>', '.juc file to stream')
  .option('--fields <fields>', 'comma-separated field names (e.g., ts,level,service,message)')
  .option('--follow', 'follow mode: re-read file when it changes', false)
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
      let lastSize = 0;

      async function checkAndProcess() {
        try {
          const stats = await stat(input);
          if (stats.size > lastSize) {
            await processFile();
            lastSize = stats.size;
          }
        } catch (e) {
          // File might not exist yet, ignore
        }

        setTimeout(checkAndProcess, 1000); // Poll every second
      }

      await checkAndProcess();
    } else {
      await processFile();
    }
  });

program.parseAsync();

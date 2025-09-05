#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { compress, compressNDJSON, decompress, decompressNDJSON } from './index.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const logo = `
   _                  _              _           _
  | | ___  _ __  ___| |__   ___  __| | ___  ___| |_ ___ _ __
  | |/ _ \\| '_ \\/ __| '_ \\ / _ \\/ _  |/ _ \\/ __| __/ _ \\\ '__|
  | | (_) | | | \\__ \\ | | |  __/ (_| |  __/\\__ \\\ ||  __/ |
  |_|\\___/|_| |_|___/_| |_|\\___|\\__,_|\\___||___/\\__\\___|_|
`;

const program = new Command();
program
  .name('json-ultra-compress')
  .description('JSON-native compression with selective field decode. Faster than Brotli. Smarter than both.')
  .version(version);

program.hook('preAction', (thisCommand, actionCommand) => {
  // Only show logo for actual commands, not help
  if (actionCommand.name() !== 'help') {
    console.error(chalk.cyan(logo));
  }
});


program
  .command('compress')
  .argument('<input>', 'input .json')
  .option('-o, --out <file>', 'output .juc file', 'out.juc')
  .option('--codec <name>', 'codec: gzip|brotli|zstd|hybrid', 'hybrid')
  .option('--columnar', 'use columnar NDJSON encoding', false)
  .action(async (input, opts) => {
    const json = await readFile(input, 'utf8');
    const buf = await compress(json, { codec: opts.codec });
    await writeFile(opts.out, buf);
    console.log(chalk.green(`wrote ${opts.out} (${buf.length} bytes)`));
  });

program
  .command('decompress')
  .argument('<input>', 'input .juc')
  .option('-o, --out <file>', 'output .json', 'out.json')
  .action(async (input, opts) => {
    const bytes = new Uint8Array(await readFile(input));
    const json = await decompress(bytes);
    await writeFile(opts.out, json, 'utf8');
    console.log(chalk.green(`wrote ${opts.out} (${json.length} bytes)`));
  });

program
  .command('compress-ndjson')
  .argument('<input>', 'input .ndjson')
  .option('-o, --out <file>', 'output .juc file', 'out.juc')
  .option('--codec <name>', 'codec: gzip|brotli|hybrid', 'hybrid')
  .option('--columnar', 'use columnar NDJSON encoding (recommended)', false)
  .option('--workers <count>', 'worker pool: number|auto|false (columnar only, auto for ≥32MB files)', 'false')
  .action(async (input, opts) => {
    const nd = await readFile(input, 'utf8');
    const workers = opts.workers === 'false' ? false
                  : opts.workers === 'auto' ? 'auto'
                  : parseInt(opts.workers) || false;

    const startTime = performance.now();
    const buf = await compressNDJSON(nd, {
      codec: opts.codec,
      columnar: Boolean(opts.columnar),
      workers
    });
    const endTime = performance.now();

    await writeFile(opts.out, buf);
    const workerInfo = workers === false ? '' : ` workers: ${workers === 'auto' ? 'auto' : workers},`;
    console.log(chalk.green(`wrote ${opts.out} (${buf.length} bytes, columnar: ${opts.columnar},${workerInfo} time: ${(endTime - startTime).toFixed(1)}ms)`));
  });

program
  .command('decompress-ndjson')
  .argument('<input>', 'input .juc')
  .option('-o, --out <file>', 'output .ndjson', 'out.ndjson')
  .option('--fields <fields>', 'selective decode: comma-separated field names (e.g., user_id,ts)')
  .option('--workers <count>', 'worker pool: number|auto|false (columnar only, auto for ≥50MB files)', 'false')
  .action(async (input, opts) => {
    const bytes = new Uint8Array(await readFile(input));
    const fields = opts.fields ? String(opts.fields).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
    const workers = opts.workers === 'false' ? false
                  : opts.workers === 'auto' ? 'auto'
                  : parseInt(opts.workers) || false;

    const startTime = performance.now();
    const nd = await decompressNDJSON(bytes, { fields, workers });
    const endTime = performance.now();

    await writeFile(opts.out, nd, 'utf8');
    const workerInfo = workers === false ? '' : ` workers: ${workers === 'auto' ? 'auto' : workers},`;
    const fieldsInfo = fields ? ` - projected fields: ${fields.join(', ')}` : '';
    console.log(chalk.green(`wrote ${opts.out} (${nd.length} bytes,${workerInfo} time: ${(endTime - startTime).toFixed(1)}ms)${fieldsInfo}`));
  });

program.parseAsync();

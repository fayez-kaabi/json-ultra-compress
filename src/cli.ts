#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { compress, compressNDJSON, decompress, decompressNDJSON } from './index.js';

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
  .description('JSON-native compression with selective field decode. Beats Brotli/Zstd on structured logs & APIs.')
  .version('1.1.0');

program.hook('preAction', () => {
  console.error(chalk.cyan(logo));
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
  .action(async (input, opts) => {
    const nd = await readFile(input, 'utf8');
    const buf = await compressNDJSON(nd, { codec: opts.codec, columnar: Boolean(opts.columnar) });
    await writeFile(opts.out, buf);
    console.log(chalk.green(`wrote ${opts.out} (${buf.length} bytes, columnar: ${opts.columnar})`));
  });

program
  .command('decompress-ndjson')
  .argument('<input>', 'input .juc')
  .option('-o, --out <file>', 'output .ndjson', 'out.ndjson')
  .option('--fields <fields>', 'selective decode: comma-separated field names (e.g., user_id,ts)')
  .action(async (input, opts) => {
    const bytes = new Uint8Array(await readFile(input));
    const fields = opts.fields ? String(opts.fields).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
    const nd = await decompressNDJSON(bytes, { fields });
    await writeFile(opts.out, nd, 'utf8');
    console.log(chalk.green(`wrote ${opts.out} (${nd.length} bytes)${fields ? ` - projected fields: ${fields.join(', ')}` : ''}`));
  });

program.parseAsync();

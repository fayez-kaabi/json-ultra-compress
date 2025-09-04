#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { buildSharedDictionary } from './shared-dict/builder.js';
import { serveDict } from './http/dict-server.js';
import { compress, compressNDJSON, decompress, decompressNDJSON, trainDictionary } from './index.js';
import type { KeyDict } from './types.js';

const logo = `
   _                  _              _           _
  | | ___  _ __  ___| |__   ___  __| | ___  ___| |_ ___ _ __
  | |/ _ \\| '_ \\/ __| '_ \\ / _ \\/ _  |/ _ \\/ __| __/ _ \\\ '__|
  | | (_) | | | \\__ \\ | | |  __/ (_| |  __/\\__ \\\ ||  __/ |
  |_|\\___/|_| |_|___/_| |_|\\___|\\__,_|\\___||___/\\__\\___|_|
`;

const program = new Command();
program
  .name('jsonopt')
  .description('JSON-native compression with selective decode. Beats Brotli/Zstd on structured logs & APIs.')
  .version('1.0.0');

program.hook('preAction', () => {
  console.error(chalk.cyan(logo));
});

program
  .command('train')
  .argument('<glob>', 'glob of JSON/NDJSON files')
  .option('-o, --out <file>', 'output dictionary json file', 'dict.json')
  .option('--max-keys <n>', 'max keys', (v) => parseInt(v, 10), 2048)
  .action(async (glob, opts) => {
    const dict = await trainDictionary(glob, { maxKeys: opts.maxKeys });
    await writeFile(opts.out, JSON.stringify(dict), 'utf8');
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('compress')
  .argument('<input>', 'input .json')
  .option('-o, --out <file>', 'output .jc file', 'out.jc')
  .option('--codec <name>', 'codec: gzip|brotli|zstd|hybrid', 'brotli')
  .option('--dict <file>', 'dictionary json file')
  .option('--shared-dict-id <id>', 'shared dictionary id (sha256) to advertise')
  .action(async (input, opts) => {
    const json = await readFile(input, 'utf8');
    let dict: KeyDict | null = null;

    if (opts.dict) {
      const dictData = JSON.parse(await readFile(opts.dict, 'utf8'));
      // Check if it's a SharedDict or legacy KeyDict
      if (dictData.type === 'shared') {
        const { sharedDictToKeyDict } = await import('./shared-dict/builder.js');
        dict = sharedDictToKeyDict(dictData);
      } else {
        dict = dictData;
      }
    }

    const buf = await compress(json, { codec: opts.codec, keyDict: dict, sharedDictId: opts.sharedDictId });
    await writeFile(opts.out, buf);
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('decompress')
  .argument('<input>', 'input .jc')
  .option('-o, --out <file>', 'output .json', 'out.json')
  .action(async (input, opts) => {
    const bytes = new Uint8Array(await readFile(input));
    const json = await decompress(bytes);
    await writeFile(opts.out, json, 'utf8');
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('compress-ndjson')
  .argument('<input>', 'input .ndjson')
  .option('-o, --out <file>', 'output .jc file', 'out.jc')
  .option('--codec <name>', 'codec: gzip|brotli|zstd|hybrid', 'hybrid')
  .addHelpText('after', '\nUse --codec auto to auto-select between brotli and gzip based on a small probe.')
  .option('--dict <file>', 'dictionary json file')
  .option('--columnar', 'use columnar NDJSON transform', false)
  .option('--shared-dict-id <id>', 'shared dictionary id (sha256) to advertise')
  .action(async (input, opts) => {
    const nd = await readFile(input, 'utf8');
    let dict: KeyDict | null = null;

    if (opts.dict) {
      const dictData = JSON.parse(await readFile(opts.dict, 'utf8'));
      // Check if it's a SharedDict or legacy KeyDict
      if (dictData.type === 'shared') {
        const { sharedDictToKeyDict } = await import('./shared-dict/builder.js');
        dict = sharedDictToKeyDict(dictData);
      } else {
        dict = dictData;
      }
    }

    const buf = await compressNDJSON(nd, { codec: opts.codec, keyDict: dict, sharedDictId: opts.sharedDictId, columnar: Boolean(opts.columnar) });
    await writeFile(opts.out, buf);
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('decompress-ndjson')
  .argument('<input>', 'input .jc')
  .option('-o, --out <file>', 'output .ndjson', 'out.ndjson')
  .action(async (input, opts) => {
    const bytes = new Uint8Array(await readFile(input));
    const nd = await decompressNDJSON(bytes);
    await writeFile(opts.out, nd, 'utf8');
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('build-shared-dict')
  .argument('<path>', 'dataset folder')
  .option('-o, --out <file>', 'output file', 'shared.dict.json')
  .action(async (path, opts) => {
    const dict = await buildSharedDictionary(path);
    await writeFile(opts.out, JSON.stringify(dict), 'utf8');
    console.log(chalk.green(`wrote ${opts.out}`));
  });

program
  .command('serve-dict')
  .option('--file <file>', 'dict json file', 'shared.dict.json')
  .option('--port <n>', 'port', (v) => parseInt(v, 10), 4711)
  .action(async (opts) => {
    const server = await serveDict({ file: opts.file, port: opts.port });
    console.log(chalk.green(`dict server on http://localhost:${opts.port}/__jc-dict/<id>`));
    process.on('SIGINT', () => server.close(() => process.exit(0)));
  });

program.parseAsync();

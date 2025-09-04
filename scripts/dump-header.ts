#!/usr/bin/env tsx

import { readFile } from 'fs/promises';
import { decodeContainer } from '../src/container.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error('Usage: dump-header <file.jc>');
    process.exit(1);
  }

  const filename = args[0];

  try {
    const bytes = new Uint8Array(await readFile(filename));
    const { header } = decodeContainer(bytes);

    // Pretty-print the header JSON
    console.log(JSON.stringify(header, null, 2));
  } catch (error) {
    console.error('Error reading container:', error);
    process.exit(1);
  }
}

main().catch(console.error);

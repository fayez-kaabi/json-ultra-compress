import { readFile } from 'fs/promises';
import { codecs, compress, compressNDJSON } from '../src/index.js';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith('--'));
  const codecArg = args.find(arg => arg.startsWith('--codec='));
  const specificCodec = codecArg?.split('=')[1];

  if (!file) {
    console.error('Usage: npm run bench -- <file.json|file.ndjson> [--codec=<codec>]');
    process.exit(1);
  }

  const raw = await readFile(file, 'utf8');
  const isNd = file.endsWith('.ndjson');
  const rawBytes = new TextEncoder().encode(raw);
  console.log(`Raw: ${rawBytes.byteLength} bytes`);

  const codecsToTest = specificCodec
    ? [specificCodec as keyof typeof codecs]
    : ['gzip', 'brotli', 'hybrid', 'hybrid'] as const;

  for (const name of codecsToTest) {
    try {
      const start = performance.now();
      const container = isNd
        ? await compressNDJSON(raw, { codec: name, columnar: true })
        : await compress(raw, { codec: name });
      const end = performance.now();
      console.log(`${name}: ${container.byteLength} bytes (ratio ${(container.byteLength / rawBytes.byteLength).toFixed(3)}), time ${(end - start).toFixed(1)}ms`);
    } catch (error) {
      console.log(`${name}: FAILED - ${error.message}`);
    }
  }
}

main();



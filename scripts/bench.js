import { readFile } from 'fs/promises';
import { compress, compressNDJSON } from '../src';
async function main() {
    const file = process.argv[2];
    if (!file) {
        console.error('Usage: npm run bench -- <file.json|file.ndjson>');
        process.exit(1);
    }
    const raw = await readFile(file, 'utf8');
    const isNd = file.endsWith('.ndjson');
    const rawBytes = new TextEncoder().encode(raw);
    console.log(`Raw: ${rawBytes.byteLength} bytes`);
    for (const name of ['gzip', 'brotli', 'learned-rans']) {
        const start = performance.now();
        const container = isNd
            ? await compressNDJSON(raw, { codec: name })
            : await compress(raw, { codec: name });
        const end = performance.now();
        console.log(`${name}: ${container.byteLength} bytes (ratio ${(container.byteLength / rawBytes.byteLength).toFixed(3)}), time ${(end - start).toFixed(1)}ms`);
    }
}
main();

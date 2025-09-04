import type { Codec } from '../types.js';

let ready = false;
let Zstd: any = null;

async function ensure(): Promise<void> {
  if (ready) return;
  if (process.env.JSON_OPT_ENABLE_ZSTD !== '1') {
    throw new Error('Zstd disabled. Set JSON_OPT_ENABLE_ZSTD=1 and install optional dep @zstd/wasm');
  }
  try {
    // dynamic import; types optional
    // @ts-ignore
    const mod = await import('@zstd/wasm');
    // @ts-ignore
    Zstd = await mod.default();
    ready = true;
  } catch (err) {
    throw new Error('Failed to load @zstd/wasm. Ensure optional dependency is installed.');
  }
}

export const zstdCodec: Codec = {
  name: 'zstd',
  async encode(input) {
    await ensure();
    return Zstd.compress(new Uint8Array(input));
  },
  async decode(input) {
    await ensure();
    return Zstd.decompress(new Uint8Array(input));
  },
};



import type { Codec } from '../types.js';
import { gzipCodec } from './gzip.js';
import { brotliCodec } from './brotli.js';
import { identityCodec } from './identity.js';
import { zstdCodec } from './zstd-wasm.js';
import { hybridCodec } from './hybrid.js';

export const codecs: Record<string, Codec> = {
  gzip: gzipCodec,
  brotli: brotliCodec,
  identity: identityCodec,
  zstd: zstdCodec,
  hybrid: hybridCodec,
};



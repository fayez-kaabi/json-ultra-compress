import type { Codec } from '../types.js';
import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';

export const brotliCodec: Codec = {
  name: 'brotli',
  encode(input) {
    return new Uint8Array(
      brotliCompressSync(input, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 6,
        },
      }),
    );
  },
  decode(input) {
    return new Uint8Array(brotliDecompressSync(input));
  },
};



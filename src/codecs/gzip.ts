import type { Codec } from '../types.js';
import { gzipSync, gunzipSync } from 'zlib';

export const gzipCodec: Codec = {
  name: 'gzip',
  encode(input) {
    return new Uint8Array(gzipSync(input));
  },
  decode(input) {
    return new Uint8Array(gunzipSync(input));
  },
};



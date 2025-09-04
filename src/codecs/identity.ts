import type { Codec } from '../types.js';

export const identityCodec: Codec = {
  name: 'gzip', // name not used for identity; will not be selected by user
  encode(input) { return input; },
  decode(input) { return input; },
};



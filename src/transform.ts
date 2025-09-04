import { applyKeyDict, canonicalize, compactStringify, invertKeyDict, safeNumericCanonicalize } from './json-normalize.js';
import type { KeyDict } from './types.js';
import { utf8Encode, utf8Decode } from './utils.js';

export interface EncodeTransformOptions {
  keyDict?: KeyDict | null;
}

export function runEncodeTransforms(input: string, options: EncodeTransformOptions): Uint8Array {
  const json = JSON.parse(input);
  const canon = canonicalize(json);
  const numCanon = safeNumericCanonicalize(canon);
  const keyed = applyKeyDict(numCanon, options.keyDict ?? null);
  return utf8Encode(compactStringify(keyed));
}

export function runDecodeTransforms(input: Uint8Array, options: EncodeTransformOptions): string {
  const json = JSON.parse(utf8Decode(input));
  const unkeyed = invertKeyDict(json, options.keyDict ?? null);
  return compactStringify(unkeyed);
}



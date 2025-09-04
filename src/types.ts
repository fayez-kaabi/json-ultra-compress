export type CodecName = 'gzip' | 'brotli' | 'identity' | 'zstd' | 'hybrid';
export type CodecNameOrAuto = CodecName | 'auto';

export interface KeyDictEntry {
  key: string;
  code: string;
}

export interface KeyDict {
  forward: Record<string, string>; // key -> code
  inverse: Record<string, string>; // code -> key
}

export interface ContainerHeader {
  version: 1;
  codec: CodecName;
  createdAt: string;
  ndjson: boolean;
  keyDictInline: boolean;
  keyDict?: KeyDict;
  options?: Record<string, unknown>;
  sharedDictId?: string;
  mode?: 'windowed' | 'solid'; // For hybrid codec
  params?: Record<string, unknown>; // Codec parameters for solid mode
  sha256?: string; // Content verification
}

export interface Codec {
  name: CodecName;
  encode(input: Uint8Array): Uint8Array | Promise<Uint8Array>;
  decode(input: Uint8Array): Uint8Array | Promise<Uint8Array>;
}



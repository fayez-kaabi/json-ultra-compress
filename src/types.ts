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

// Selective decode interfaces
export interface Bitset {
  get(i: number): boolean;
  length: number;
}

export interface ColumnReader {
  present(i: number): boolean;  // from per-column presence bitmap
  next(): any;                  // yields decoded JS value for current row (deprecated)
  getValue(i: number): any;     // get value for specific row index
}

export interface Window {
  numRows: number;
  linePresence?: Bitset;        // preserves empty/whitespace lines
  getReader(field: string): ColumnReader | null;
  keyOrder: string[];           // deterministic order used in this window
}

export interface ColumnarHandle {
  windows: Window[];
  keySet: Set<string>;          // union of keys across windows (optional)
}

// Worker pool options
export interface WorkerOptions {
  workers?: number | 'auto' | false; // default false
}



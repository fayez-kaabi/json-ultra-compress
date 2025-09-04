import type { KeyDict } from './types.js';

function stableSortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stableSortKeys);
  if (obj && typeof obj === 'object') {
    const rec: Record<string, unknown> = obj as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = stableSortKeys(rec[k]);
    return out;
  }
  return obj;
}

export function canonicalize(json: unknown): unknown {
  return stableSortKeys(json);
}

export function safeNumericCanonicalize(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(safeNumericCanonicalize);
  if (json && typeof json === 'object') {
    const rec = json as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = safeNumericCanonicalize(v);
    return out;
  }
  if (typeof json === 'number') {
    if (Number.isFinite(json)) return json; // keep as number; JSON.stringify will canonicalize
  }
  return json;
}

export function applyKeyDict(obj: unknown, dict: KeyDict | null): unknown {
  if (!dict) return obj;
  if (Array.isArray(obj)) return obj.map((v) => applyKeyDict(v, dict));
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      const code = dict.forward[k];
      out[code ?? k] = applyKeyDict(v, dict);
    }
    return out;
  }
  return obj;
}

export function invertKeyDict(obj: unknown, dict: KeyDict | null): unknown {
  if (!dict) return obj;
  if (Array.isArray(obj)) return obj.map((v) => invertKeyDict(v, dict));
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      const key = dict.inverse[k];
      out[key ?? k] = invertKeyDict(v, dict);
    }
    return out;
  }
  return obj;
}

export function compactStringify(obj: unknown): string {
  return JSON.stringify(obj);
}



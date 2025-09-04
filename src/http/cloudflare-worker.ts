import { compress } from '..';
import type { KeyDict } from '../types';
import { sharedDictId } from '../shared-dict/id.js';

export interface WorkerEnv {
  SHARED_DICT_JSON?: string; // KV or bound string with JSON
}

export function createWorkerHandler(dict: KeyDict | null = null) {
  return {
    async fetch(req: Request, _env: WorkerEnv): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === '/example') {
        const body = JSON.stringify({ hello: 'world' });
        const accept = req.headers.get('Accept-Encoding') || '';
        if (accept.includes('jcbr')) {
          const dictId = dict ? sharedDictId(JSON.stringify(dict)) : undefined;
          const buf = await compress(body, { codec: 'brotli', keyDict: dict, sharedDictId: dictId });
          return new Response(buf, { headers: { 'Content-Encoding': 'jcbr', 'Content-Type': 'application/octet-stream', ...(dictId ? { 'X-JC-Dict-Id': dictId } : {}) } });
        }
        return new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}



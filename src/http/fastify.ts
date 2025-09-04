import { compress } from '..';
import type { KeyDict } from '../types';
import { sharedDictId } from '../shared-dict/id.js';

export interface FastifyPluginOptions {
  dict?: KeyDict | null;
  codec?: 'brotli' | 'gzip' | 'hybrid' | 'zstd';
}

export function jsonOptimizerFastify(app: any, opts: FastifyPluginOptions = {}, done: (err?: Error) => void) {
  const codec = opts.codec ?? 'brotli';
  app.addHook('onSend', async (req: any, reply: any, payload: any) => {
    const accept = String(req.headers['accept-encoding'] || '');
    if (!accept.includes('jcbr')) return payload;
    try {
      if (typeof payload === 'string') {
        const dictId = opts.dict ? sharedDictId(JSON.stringify(opts.dict)) : undefined;
        const buf = await compress(payload, { codec, keyDict: opts.dict ?? null, sharedDictId: dictId });
        reply.header('Content-Encoding', 'jcbr');
        reply.header('Content-Type', 'application/octet-stream');
        if (dictId) reply.header('X-JC-Dict-Id', dictId);
        reply.header('Vary', 'Accept-Encoding');
        return Buffer.from(buf);
      }
      return payload;
    } catch {
      return payload;
    }
  });
  done();
}



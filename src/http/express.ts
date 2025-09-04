import { compress } from '..';
import type { KeyDict } from '../types';
import { sharedDictId } from '../shared-dict/id.js';

export interface ExpressMiddlewareOptions {
  dict?: KeyDict | null;
  codec?: 'brotli' | 'gzip' | 'hybrid' | 'zstd';
}

export function jsonOptimizerMiddleware(opts: ExpressMiddlewareOptions = {}) {
  const codec = opts.codec ?? 'brotli';
  return async (req: any, res: any, next: any) => {
    const accept = String(req.header('Accept-Encoding') || '');
    if (!accept.includes('jcbr')) return next();
    const originalSend = res.send.bind(res);
    res.send = ((body?: any): any => {
      if (typeof body === 'object') {
        const json = JSON.stringify(body);
        const dictId = opts.dict ? sharedDictId(JSON.stringify(opts.dict)) : undefined;
        compress(json, { codec, keyDict: opts.dict ?? null, sharedDictId: dictId }).then((buf) => {
          res.setHeader('Content-Encoding', 'jcbr');
          res.setHeader('Content-Type', 'application/octet-stream');
          if (dictId) res.setHeader('X-JC-Dict-Id', dictId);
          res.setHeader('Vary', 'Accept-Encoding');
          originalSend(Buffer.from(buf));
        }).catch(() => originalSend(body));
        return res;
      }
      return originalSend(body);
    }) as any;
    next();
  };
}

export function mountDictRoute(app: any, dictJson: string) {
  const id = sharedDictId(dictJson);
  app.get('/__jc-dict/:id', (req: any, res: any) => {
    if (req.params.id !== id) { res.status(404).send('Not found'); return; }
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', id);
    res.send(dictJson);
  });
}



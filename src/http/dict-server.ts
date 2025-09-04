import http from 'http';
import { readFile } from 'fs/promises';
import crypto from 'crypto';

export interface ServeDictOptions {
  file: string;
  port?: number;
}

export async function serveDict(opts: ServeDictOptions): Promise<http.Server> {
  const json = await readFile(opts.file, 'utf8');
  const etag = crypto.createHash('sha256').update(json).digest('hex');
  const server = http.createServer((req, res) => {
    if (!req.url) { res.statusCode = 400; return res.end('Bad request'); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/__jc-dict/')) {
      const id = url.pathname.split('/').pop();
      if (!id || id !== etag) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', etag);
      return res.end(json);
    }
    res.statusCode = 404; res.end('Not found');
  });
  const port = opts.port ?? 4711;
  await new Promise<void>((r) => server.listen(port, r));
  return server;
}



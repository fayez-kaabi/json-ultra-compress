#!/usr/bin/env tsx
/**
 * Cloudflare Worker Example
 * Shows how to use json-ultra-compress in a Cloudflare Worker environment
 */

import { compress, decompress, compressNDJSON, decompressNDJSON } from '../dist/index.js';

// Example: Compress API responses for better performance
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/data' && request.method === 'GET') {
    // Generate sample data
    const data = {
      users: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        active: Math.random() > 0.2,
        lastLogin: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()
      })),
      meta: {
        total: 100,
        generated: new Date().toISOString(),
        version: '1.1.0'
      }
    };

    const jsonString = JSON.stringify(data);
    const compressed = await compress(jsonString, { codec: 'hybrid' });

    return new Response(compressed, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Original-Size': jsonString.length.toString(),
        'X-Compressed-Size': compressed.length.toString(),
        'X-Compression-Ratio': (compressed.length / jsonString.length * 100).toFixed(1) + '%',
        'X-Compression-Method': 'json-ultra-compress-hybrid'
      }
    });
  }

  if (url.pathname === '/api/logs' && request.method === 'GET') {
    // Generate sample NDJSON logs
    const logs = Array.from({ length: 50 }, (_, i) => JSON.stringify({
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      level: ['info', 'warn', 'error'][Math.floor(Math.random() * 3)],
      message: `Log entry ${i}`,
      userId: `user_${Math.floor(Math.random() * 20)}`,
      requestId: `req_${Math.random().toString(36).substr(2, 9)}`
    })).join('\\n');

    const compressed = await compressNDJSON(logs, { codec: 'hybrid', columnar: true });

    return new Response(compressed, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Original-Size': logs.length.toString(),
        'X-Compressed-Size': compressed.length.toString(),
        'X-Format': 'ndjson-columnar',
        'X-Selective-Decode': 'supported'
      }
    });
  }

  if (url.pathname === '/api/decompress' && request.method === 'POST') {
    try {
      const compressedData = new Uint8Array(await request.arrayBuffer());
      const decompressed = await decompress(compressedData);
      const parsed = JSON.parse(decompressed);

      return Response.json({
        success: true,
        originalSize: compressedData.length,
        decompressedSize: decompressed.length,
        recordCount: Array.isArray(parsed.users) ? parsed.users.length : 'N/A'
      });
    } catch (error) {
      return Response.json({ error: 'Invalid compressed data' }, { status: 400 });
    }
  }

  // Default response
  return Response.json({
    message: 'json-ultra-compress Cloudflare Worker',
    endpoints: [
      'GET /api/data - Compressed JSON response',
      'GET /api/logs - Compressed NDJSON logs (columnar)',
      'POST /api/decompress - Decompress uploaded data'
    ]
  });
}

// Cloudflare Worker export
export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  }
};



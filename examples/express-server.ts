#!/usr/bin/env tsx
/**
 * Express Server Example
 * Shows how to use json-ultra-compress in an Express.js application
 */

import express from 'express';
import { compress, decompress } from '../dist/index.js';

const app = express();

// Middleware to compress JSON responses
app.use(express.json());

// Example endpoint that returns compressed JSON
app.get('/api/users', async (_req, res) => {
  const data = {
    users: [
      { id: 1, name: 'Alice', role: 'admin', active: true },
      { id: 2, name: 'Bob', role: 'user', active: true },
      { id: 3, name: 'Charlie', role: 'user', active: false }
    ],
    meta: { total: 3, page: 1, generated: new Date().toISOString() }
  };

  const jsonString = JSON.stringify(data);
  const compressed = await compress(jsonString, { codec: 'hybrid' });

  res.set({
    'Content-Type': 'application/octet-stream',
    'X-Original-Size': jsonString.length.toString(),
    'X-Compressed-Size': compressed.length.toString(),
    'X-Compression-Ratio': (compressed.length / jsonString.length * 100).toFixed(1) + '%'
  });

  res.send(Buffer.from(compressed));
});

// Example endpoint to decompress received data
app.post('/api/decompress', async (req, res) => {
  try {
    const compressedData = new Uint8Array(req.body);
    const decompressed = await decompress(compressedData);
    const parsed = JSON.parse(decompressed);

    res.json({
      success: true,
      originalSize: compressedData.length,
      decompressedSize: decompressed.length,
      data: parsed
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid compressed data' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 json-ultra-compress Express server running on http://localhost:${port}`);
  console.log('Try: GET /api/users for compressed JSON response');
});



/**
 * Worker Entry Point for Columnar Processing
 * Handles encoding/decoding of individual windows in parallel
 */

import { parentPort } from 'node:worker_threads';
import { codecs } from './codecs/index.js';
import type { WorkerMessage, WorkerResponse } from './worker-pool.js';

if (!parentPort) {
  throw new Error('This module must be run in a worker thread');
}

parentPort.on('message', async (message: WorkerMessage) => {
  const { id, mode, windowBytes, windowIndex, opts } = message;
  
  try {
    let result: Uint8Array;
    
    if (mode === 'encode') {
      // Encode window with specified codec
      const codec = codecs[opts.codec || 'hybrid'];
      if (!codec) {
        throw new Error(`Unknown codec: ${opts.codec}`);
      }
      
      result = await codec.encode(windowBytes);
      
    } else if (mode === 'decode') {
      // Decode window with specified codec
      const codec = codecs[opts.codec || 'hybrid'];
      if (!codec) {
        throw new Error(`Unknown codec: ${opts.codec}`);
      }
      
      result = await codec.decode(windowBytes);
      
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
    
    const response: WorkerResponse = {
      id,
      windowIndex,
      result
    };
    
    // Transfer result buffer to avoid copying
    parentPort!.postMessage(response, [result.buffer]);
    
  } catch (error) {
    const response: WorkerResponse = {
      id,
      windowIndex,
      error: error instanceof Error ? error.message : String(error)
    };
    
    parentPort!.postMessage(response);
  }
});

/**
 * Worker Pool for Parallel Processing
 * Handles large NDJSON batches by distributing work across multiple workers
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

export interface WorkerTask<TReq, TRes> {
  req: TReq;
  resolve: (value: TRes) => void;
  reject: (error: any) => void;
}

export interface WorkerMessage {
  id: string;
  mode: 'encode' | 'decode';
  windowBytes: Uint8Array;
  windowIndex: number;
  opts: any;
}

export interface WorkerResponse {
  id: string;
  windowIndex: number;
  result?: Uint8Array;
  error?: string;
}

export class WorkerPool<TReq extends WorkerMessage, TRes extends WorkerResponse> {
  private queue: WorkerTask<TReq, TRes>[] = [];
  private idle: Worker[] = [];
  private busy: Set<Worker> = new Set();
  private all: Worker[] = [];
  private pendingTasks: Map<string, WorkerTask<TReq, TRes>> = new Map();

  constructor(private workerPath: string, private size: number) {
    for (let i = 0; i < size; i++) {
      this.spawn();
    }
  }

  private spawn() {
    const worker = new Worker(this.workerPath);
    
    worker.on('message', (response: TRes) => {
      const task = this.pendingTasks.get(response.id);
      if (!task) return;
      
      this.pendingTasks.delete(response.id);
      this.busy.delete(worker);
      this.idle.push(worker);
      
      if (response.error) {
        task.reject(new Error(`Worker error (window ${response.windowIndex}): ${response.error}`));
      } else {
        task.resolve(response);
      }
      
      this.processQueue();
    });
    
    worker.on('error', (error) => {
      // Find and reject all tasks for this worker
      for (const [id, task] of this.pendingTasks) {
        if (this.busy.has(worker)) {
          this.pendingTasks.delete(id);
          task.reject(error);
        }
      }
      
      this.busy.delete(worker);
      // Respawn worker
      const index = this.all.indexOf(worker);
      if (index !== -1) {
        this.all[index] = this.spawn();
      }
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`Worker exited with code ${code}`);
      }
    });
    
    this.idle.push(worker);
    this.all.push(worker);
    return worker;
  }

  async run(req: TReq): Promise<TRes> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask<TReq, TRes> = { req, resolve, reject };
      
      if (this.idle.length > 0) {
        this.assignTask(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private assignTask(task: WorkerTask<TReq, TRes>) {
    const worker = this.idle.pop();
    if (!worker) {
      this.queue.push(task);
      return;
    }
    
    this.busy.add(worker);
    this.pendingTasks.set(task.req.id, task);
    
    // Transfer ArrayBuffer to avoid copying
    const transferList = task.req.windowBytes ? [task.req.windowBytes.buffer] : [];
    worker.postMessage(task.req, transferList);
  }

  private processQueue() {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const task = this.queue.shift()!;
      this.assignTask(task);
    }
  }

  async destroy() {
    await Promise.all(this.all.map(worker => worker.terminate()));
    this.all = [];
    this.idle = [];
    this.busy.clear();
    this.pendingTasks.clear();
  }

  get activeCount() {
    return this.busy.size;
  }

  get queueLength() {
    return this.queue.length;
  }
}

/**
 * Get optimal worker pool size
 */
export function getOptimalPoolSize(): number {
  const cpuCount = cpus().length;
  return Math.min(Math.max(cpuCount - 1, 1), 4);
}

/**
 * Determine if workers should be used based on input size
 */
export function shouldUseWorkers(
  inputSize: number, 
  windowCount: number, 
  workersOption: number | 'auto' | false
): number {
  if (workersOption === false) return 0;
  if (typeof workersOption === 'number') return workersOption;
  
  // Auto mode: use workers for large inputs
  const isLargeInput = inputSize >= 32 * 1024 * 1024; // 32MB
  const isManyWindows = windowCount >= 64;
  
  return (isLargeInput || isManyWindows) ? getOptimalPoolSize() : 0;
}

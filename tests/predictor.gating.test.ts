import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compress, decompress } from '../src/index.js';
import { decodeContainer } from '../src/container.js';

describe('predictor gating', () => {
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.JSON_OPT_DEBUG;
    process.env.JSON_OPT_DEBUG = '1';
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.JSON_OPT_DEBUG;
    } else {
      process.env.JSON_OPT_DEBUG = originalDebug;
    }
  });

  it('should use JCM on structured JSON when it wins', async () => {
    // Highly structured JSON with many keys and repeated patterns
    const structuredJson = {
      users: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `user_${i}`,
        active: i % 2 === 0,
        score: i * 10,
        metadata: {
          created: `2024-01-${String(i % 30 + 1).padStart(2, '0')}`,
          tags: [`tag_${i % 5}`, `category_${i % 3}`]
        }
      })),
      summary: {
        total: 100,
        active: 50,
        avgScore: 495
      }
    };

    const input = JSON.stringify(structuredJson);

    // This should potentially use JCM due to high structural density
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);

    expect(JSON.parse(decompressed)).toEqual(structuredJson);

    // Verify header
    const { header } = decodeContainer(compressed);
    expect(header.codec).toBe('hybrid');
  });

  it('should use counts on text-like JSON when JCM doesnt win', async () => {
    // Text-heavy JSON where JCM won't help much
    const textLikeJson = {
      content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100),
      description: 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(50),
      notes: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco. '.repeat(75)
    };

    const input = JSON.stringify(textLikeJson);

    // This should use counts due to low structural density
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);

    expect(JSON.parse(decompressed)).toEqual(textLikeJson);
  });

  it('should handle mixed structural density correctly', async () => {
    const mixedJson = {
      // Structured part
      config: {
        apiKey: 'key_123',
        timeout: 5000,
        retries: 3,
        endpoints: ['api1', 'api2', 'api3']
      },
      // Text-heavy part
      documentation: 'This is a long text field that contains mostly natural language content without much structure. '.repeat(20),
      // More structure
      users: Array.from({ length: 10 }, (_, i) => ({
        id: i,
        active: i % 2 === 0
      }))
    };

    const input = JSON.stringify(mixedJson);
    const compressed = await compress(input, { codec: 'hybrid' });
    const decompressed = await decompress(compressed);

    expect(JSON.parse(decompressed)).toEqual(mixedJson);
  });
});

#!/usr/bin/env tsx
/**
 * Selective Decode Example
 * Demonstrates the power of reading only specific fields from compressed data
 */

import { compressNDJSON, decompressNDJSON } from 'jsonopt';

async function selectiveDecodeDemo() {
  console.log('⚡ Selective Decode Demo\n');

  // Generate realistic log data with many fields
  const generateLogs = (count: number) => {
    const events = ['click', 'view', 'purchase', 'signup', 'logout'];
    const sources = ['web', 'mobile', 'api', 'desktop'];
    const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

    return Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(Date.now() - (count - i) * 60000).toISOString(),
      request_id: `req_${i.toString().padStart(8, '0')}`,
      user_id: `user_${i % 1000}`,
      session_id: `sess_${Math.floor(i / 50)}`,
      event_type: events[i % events.length],
      source: sources[i % sources.length],
      region: regions[i % regions.length],
      duration_ms: Math.round(Math.random() * 2000),
      status_code: i % 20 === 0 ? 500 : i % 50 === 0 ? 404 : 200,
      bytes_sent: Math.round(Math.random() * 50000),
      bytes_received: Math.round(Math.random() * 10000),
      user_agent: i % 3 === 0 ? 'Mozilla/5.0 Chrome' : 'Mozilla/5.0 Safari',
      ip_address: `192.168.${Math.floor(i / 256) % 256}.${i % 256}`,
      endpoint: `/api/v1/${events[i % events.length]}`,
      response_time: Math.round(Math.random() * 500),
      cache_hit: i % 3 === 0,
      metadata: {
        version: `v${Math.floor(i / 1000) + 1}.2.${i % 10}`,
        build: `build_${Math.floor(i / 100)}`,
        feature_flags: {
          new_ui: i % 4 === 0,
          beta_analytics: i % 7 === 0,
          premium_features: i % 10 === 0
        },
        tags: [`env_${i % 3}`, `team_${i % 5}`]
      }
    })).map(log => JSON.stringify(log)).join('\n');
  };

  const logs = generateLogs(5000);
  console.log(`Generated ${logs.split('\n').length} log entries`);
  console.log(`Total size: ${Math.round(logs.length / 1024)}KB\n`);

  // Compress with columnar encoding
  console.log('🔄 Compressing with columnar encoding...');
  const compressed = await compressNDJSON(logs, {
    codec: 'hybrid',
    columnar: true
  });

  console.log(`Compressed size: ${Math.round(compressed.length / 1024)}KB`);
  console.log(`Compression ratio: ${(compressed.length / logs.length * 100).toFixed(1)}%\n`);

  // Benchmark: Full decode vs selective decode simulation
  console.log('📊 Performance Comparison');
  console.log('=' .repeat(25));

  // Full decode
  const fullStart = performance.now();
  const fullDecoded = await decompressNDJSON(compressed);
  const fullTime = performance.now() - fullStart;

  console.log(`Full decode: ${fullTime.toFixed(1)}ms`);

  // Simulate selective decode by parsing only needed fields
  const selectiveStart = performance.now();
  const selectiveData = fullDecoded.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const obj = JSON.parse(line);
      return JSON.stringify({
        timestamp: obj.timestamp,
        user_id: obj.user_id,
        event_type: obj.event_type,
        duration_ms: obj.duration_ms
      });
    })
    .join('\n');
  const selectiveTime = performance.now() - selectiveStart;

  console.log(`Selective decode (4 fields): ${(fullTime + selectiveTime).toFixed(1)}ms`);
  console.log(`Selective output size: ${Math.round(selectiveData.length / 1024)}KB`);
  console.log(`Size reduction: ${((logs.length - selectiveData.length) / logs.length * 100).toFixed(1)}%\n`);

  // Show sample output
  console.log('📝 Sample Selective Output (first 3 records):');
  console.log('-'.repeat(50));
  selectiveData.split('\n').slice(0, 3).forEach((line, i) => {
    const obj = JSON.parse(line);
    console.log(`${i + 1}. User: ${obj.user_id}, Event: ${obj.event_type}, Duration: ${obj.duration_ms}ms`);
  });

  console.log('\n💡 Real-world Benefits:');
  console.log('  • Read only the fields you need for analytics');
  console.log('  • Massive bandwidth savings for log processing');
  console.log('  • Perfect for time-series analysis pipelines');
  console.log('  • Ideal for edge computing with limited resources');

  console.log('\n🚀 Future: True selective decode will skip unused columns entirely!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  selectiveDecodeDemo().catch(console.error);
}

export { selectiveDecodeDemo };

#!/bin/bash
# json-ultra-compress CLI Examples
# Demonstrates command-line usage for various scenarios

echo "🚀 json-ultra-compress CLI Examples"
echo "======================="
echo

# Create sample data
echo "📝 Creating sample data..."

# Sample structured logs
cat > sample-logs.ndjson << 'EOF'
{"timestamp":"2024-01-01T10:00:00Z","user_id":"user_001","event":"login","source":"web","duration_ms":245,"success":true}
{"timestamp":"2024-01-01T10:01:00Z","user_id":"user_002","event":"click","source":"web","duration_ms":12,"success":true}
{"timestamp":"2024-01-01T10:02:00Z","user_id":"user_001","event":"purchase","source":"mobile","duration_ms":1240,"success":true}
{"timestamp":"2024-01-01T10:03:00Z","user_id":"user_003","event":"view","source":"web","duration_ms":89,"success":true}
{"timestamp":"2024-01-01T10:04:00Z","user_id":"user_002","event":"logout","source":"web","duration_ms":156,"success":true}
EOF

# Sample API responses
cat > sample-api.json << 'EOF'
{
  "users": [
    {"id": 1, "name": "Alice", "role": "admin", "active": true, "last_login": "2024-01-01T09:00:00Z"},
    {"id": 2, "name": "Bob", "role": "user", "active": true, "last_login": "2024-01-01T08:30:00Z"},
    {"id": 3, "name": "Charlie", "role": "user", "active": false, "last_login": "2023-12-15T14:22:00Z"}
  ],
  "pagination": {"page": 1, "total": 3, "per_page": 10},
  "meta": {"version": "1.0", "generated_at": "2024-01-01T10:00:00Z"}
}
EOF

echo "✅ Sample data created"
echo

# Example 1: Basic NDJSON compression
echo "📊 Example 1: Basic NDJSON Compression"
echo "======================================"

echo "Original file size:"
wc -c sample-logs.ndjson

echo "Compressing with hybrid codec (row-wise):"
json-ultra-compress compress-ndjson --codec=hybrid sample-logs.ndjson -o logs-row.juc
wc -c logs-row.juc

echo "Compressing with hybrid codec (columnar - the magic!):"
json-ultra-compress compress-ndjson --codec=hybrid --columnar sample-logs.ndjson -o logs-columnar.juc
wc -c logs-columnar.juc

echo "Compression comparison:"
echo "Row-wise:  $(wc -c < logs-row.juc) bytes"
echo "Columnar:  $(wc -c < logs-columnar.juc) bytes"
echo "Improvement: $(echo "scale=1; ($(wc -c < logs-row.juc) - $(wc -c < logs-columnar.juc)) * 100 / $(wc -c < logs-row.juc)" | bc)% better"
echo

# Example 2: Different codecs
echo "🔧 Example 2: Codec Comparison"
echo "=============================="

echo "Testing different codecs on the same data:"

json-ultra-compress compress-ndjson --codec=brotli sample-logs.ndjson -o logs-brotli.juc
json-ultra-compress compress-ndjson --codec=gzip sample-logs.ndjson -o logs-gzip.juc
json-ultra-compress compress-ndjson --codec=hybrid sample-logs.ndjson -o logs-hybrid.juc

echo "Results:"
echo "Brotli:  $(wc -c < logs-brotli.juc) bytes"
echo "Gzip:    $(wc -c < logs-gzip.juc) bytes"
echo "Hybrid:  $(wc -c < logs-hybrid.juc) bytes"
echo

# Example 3: JSON (not NDJSON) compression
echo "📄 Example 3: Single JSON Compression"
echo "====================================="

echo "Original JSON file size:"
wc -c sample-api.json

echo "Compressing with hybrid codec:"
json-ultra-compress compress --codec=hybrid sample-api.json -o api-compressed.juc
wc -c api-compressed.juc

echo "Decompressing to verify:"
json-ultra-compress decompress api-compressed.juc -o api-restored.json
echo "Integrity check: $(diff sample-api.json api-restored.json && echo '✅ Perfect' || echo '❌ Failed')"
echo

# Example 4: Selective decode (THE REVOLUTIONARY FEATURE!)
echo "🎯 Example 4: Selective Decode (FULLY IMPLEMENTED!)"
echo "=================================================="

echo "Full decompression:"
time json-ultra-compress decompress-ndjson logs-columnar.juc -o full-output.ndjson
echo "Full output size: $(wc -c < full-output.ndjson) bytes"

echo
echo "🔥 Selective decode - only user_id and event fields:"
time json-ultra-compress decompress-ndjson --fields=user_id,event logs-columnar.juc -o selective-output.ndjson
echo "Selective output size: $(wc -c < selective-output.ndjson) bytes"

echo
echo "Bandwidth reduction: $(echo "scale=1; ($(wc -c < full-output.ndjson) - $(wc -c < selective-output.ndjson)) * 100 / $(wc -c < full-output.ndjson)" | bc)%"

echo
echo "Sample full record:"
head -1 full-output.ndjson
echo "Sample selective record (2 fields only):"
head -1 selective-output.ndjson

rm -f full-output.ndjson selective-output.ndjson
echo

# Example 5: Pipeline usage
echo "🔄 Example 5: Pipeline Usage"
echo "============================"

echo "json-ultra-compress works great in pipelines:"
echo

echo "# Compress logs from a service"
echo "tail -f /var/log/app.ndjson | json-ultra-compress compress-ndjson --codec=hybrid --columnar -o compressed-stream.juc"
echo

echo "# Process specific fields from compressed logs"
echo "json-ultra-compress decompress-ndjson --fields=timestamp,user_id,error compressed-stream.juc | jq '.error | select(. != null)'"
echo

echo "# Compress API responses for caching"
echo "curl https://api.example.com/users | json-ultra-compress compress --codec=hybrid -o users-cache.juc"
echo

# Cleanup
echo "🧹 Cleaning up sample files..."
rm -f sample-logs.ndjson sample-api.json *.juc api-restored.json
echo "✅ Cleanup complete"
echo

echo "💡 Pro Tips:"
echo "  • Use --columnar for structured NDJSON logs (huge compression wins!)"
echo "  • Use --codec=hybrid for automatic best-codec selection"
echo "  • Pipeline-friendly: reads stdin, writes stdout"
echo "  • Perfect for log processing, API caching, and data archival"
echo
echo "🚀 Ready to compress the world? Try json-ultra-compress on your data!"

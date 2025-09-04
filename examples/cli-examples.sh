#!/bin/bash
# JSONOpt CLI Examples
# Demonstrates command-line usage for various scenarios

echo "🚀 JSONOpt CLI Examples"
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
json-ultra-compress compress --codec=hybrid < sample-logs.ndjson > logs-row.jopt
wc -c logs-row.jopt

echo "Compressing with hybrid codec (columnar - the magic!):"
json-ultra-compress compress --codec=hybrid --columnar < sample-logs.ndjson > logs-columnar.jopt
wc -c logs-columnar.jopt

echo "Compression comparison:"
echo "Row-wise:  $(wc -c < logs-row.jopt) bytes"
echo "Columnar:  $(wc -c < logs-columnar.jopt) bytes"
echo "Improvement: $(echo "scale=1; ($(wc -c < logs-row.jopt) - $(wc -c < logs-columnar.jopt)) * 100 / $(wc -c < logs-row.jopt)" | bc)% better"
echo

# Example 2: Different codecs
echo "🔧 Example 2: Codec Comparison"
echo "=============================="

echo "Testing different codecs on the same data:"

json-ultra-compress compress --codec=brotli < sample-logs.ndjson > logs-brotli.jopt
json-ultra-compress compress --codec=gzip < sample-logs.ndjson > logs-gzip.jopt
json-ultra-compress compress --codec=hybrid < sample-logs.ndjson > logs-hybrid.jopt

echo "Results:"
echo "Brotli:  $(wc -c < logs-brotli.jopt) bytes"
echo "Gzip:    $(wc -c < logs-gzip.jopt) bytes"
echo "Hybrid:  $(wc -c < logs-hybrid.jopt) bytes"
echo

# Example 3: JSON (not NDJSON) compression
echo "📄 Example 3: Single JSON Compression"
echo "====================================="

echo "Original JSON file size:"
wc -c sample-api.json

echo "Compressing with hybrid codec:"
json-ultra-compress compress --codec=hybrid < sample-api.json > api-compressed.jopt
wc -c api-compressed.jopt

echo "Decompressing to verify:"
json-ultra-compress decompress < api-compressed.jopt > api-restored.json
echo "Integrity check: $(diff sample-api.json api-restored.json && echo '✅ Perfect' || echo '❌ Failed')"
echo

# Example 4: Selective decode simulation
echo "⚡ Example 4: Selective Decode (Simulated)"
echo "========================================="

echo "Full decompression:"
time json-ultra-compress decompress < logs-columnar.jopt > /dev/null

echo "In the future, you'll be able to do:"
echo "json-ultra-compress decompress --fields=user_id,event,timestamp < logs-columnar.jopt"
echo "This will read only the specified fields, making it much faster!"
echo

# Example 5: Pipeline usage
echo "🔄 Example 5: Pipeline Usage"
echo "============================"

echo "JSONOpt works great in pipelines:"
echo

echo "# Compress logs from a service"
echo "tail -f /var/log/app.ndjson | json-ultra-compress compress --codec=hybrid --columnar > compressed-stream.jopt"
echo

echo "# Process specific fields from compressed logs"
echo "json-ultra-compress decompress --fields=timestamp,user_id,error < compressed-stream.jopt | jq '.error | select(. != null)'"
echo

echo "# Compress API responses for caching"
echo "curl https://api.example.com/users | json-ultra-compress compress --codec=hybrid > users-cache.jopt"
echo

# Cleanup
echo "🧹 Cleaning up sample files..."
rm -f sample-logs.ndjson sample-api.json *.jopt api-restored.json
echo "✅ Cleanup complete"
echo

echo "💡 Pro Tips:"
echo "  • Use --columnar for structured NDJSON logs (huge compression wins!)"
echo "  • Use --codec=hybrid for automatic best-codec selection"
echo "  • Pipeline-friendly: reads stdin, writes stdout"
echo "  • Perfect for log processing, API caching, and data archival"
echo
echo "🚀 Ready to compress the world? Try json-ultra-compress on your data!"

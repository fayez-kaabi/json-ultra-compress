# JSON Ultra Compress Benchmark Report

Generated: 2025-09-05T01:00:17.618Z

## 🎯 OBJECTIVE

Compare json-ultra-compress against standard compression methods (gzip, brotli) on realistic datasets to demonstrate real-world performance benefits.

## 🧪 TEST DATASETS

- **api_responses**: Typical API responses with user events and metadata (480.2 KB)
- **server_logs**: Structured application logs with metrics and metadata (716.5 KB)
- **analytics_events**: User behavior analytics with nested properties (1848.6 KB)
- **ecommerce_catalog**: E-commerce product catalog with reviews and inventory (532.2 KB)

## 📈 DETAILED RESULTS

### api_responses

| Method                       | Size (KB) | Ratio | Comp Time (ms) | Decomp Time (ms) | Selective (ms) | Selective Size (KB) |
|------------------------------|-----------|-------|----------------|------------------|----------------|---------------------|
| Standard Gzip                | 45.6      | 9.5%  | 5.5            | 0.0              | N/A            | N/A                 |
| Standard Brotli              | 34.0      | 7.1%  | 873.6          | 0.0              | N/A            | N/A                 |
| json-ultra-compress (gzip)   | 42.5      | 8.8%  | 17.3           | 4.3              | N/A            | N/A                 |
| json-ultra-compress (brotli) | 39.4      | 8.2%  | 19.3           | 7.3              | N/A            | N/A                 |
| json-ultra-compress (hybrid) | 39.4      | 8.2%  | 45.8           | 4.0              | N/A            | N/A                 |

### server_logs

| Method                       | Size (KB) | Ratio | Comp Time (ms) | Decomp Time (ms) | Selective (ms) | Selective Size (KB) |
|------------------------------|-----------|-------|----------------|------------------|----------------|---------------------|
| Standard Gzip                | 111.8     | 15.6% | 7.1            | 0.0              | N/A            | N/A                 |
| Standard Brotli              | 87.7      | 12.2% | 1478.6         | 0.0              | N/A            | N/A                 |
| json-ultra-compress (gzip)   | 97.0      | 13.5% | 51.1           | 24.9             | 4.8            | 109.2               |
| json-ultra-compress (brotli) | 92.0      | 12.8% | 40.7           | 17.9             | 4.8            | 109.2               |
| json-ultra-compress (hybrid) | 92.0      | 12.8% | 79.1           | 13.1             | 3.9            | 109.2               |

### analytics_events

| Method                       | Size (KB) | Ratio | Comp Time (ms) | Decomp Time (ms) | Selective (ms) | Selective Size (KB) |
|------------------------------|-----------|-------|----------------|------------------|----------------|---------------------|
| Standard Gzip                | 167.4     | 9.1%  | 16.7           | 0.0              | N/A            | N/A                 |
| Standard Brotli              | 119.8     | 6.5%  | 3647.4         | 0.0              | N/A            | N/A                 |
| json-ultra-compress (gzip)   | 141.2     | 7.6%  | 92.6           | 44.5             | 12.7           | 381.7               |
| json-ultra-compress (brotli) | 125.1     | 6.8%  | 91.3           | 42.0             | 12.6           | 381.7               |
| json-ultra-compress (hybrid) | 125.1     | 6.8%  | 177.4          | 43.3             | 13.9           | 381.7               |

### ecommerce_catalog

| Method                       | Size (KB) | Ratio | Comp Time (ms) | Decomp Time (ms) | Selective (ms) | Selective Size (KB) |
|------------------------------|-----------|-------|----------------|------------------|----------------|---------------------|
| Standard Gzip                | 40.4      | 7.6%  | 3.7            | 0.0              | N/A            | N/A                 |
| Standard Brotli              | 28.3      | 5.3%  | 911.6          | 0.0              | N/A            | N/A                 |
| json-ultra-compress (gzip)   | 36.3      | 6.8%  | 13.4           | 3.7              | N/A            | N/A                 |
| json-ultra-compress (brotli) | 33.5      | 6.3%  | 15.8           | 3.9              | N/A            | N/A                 |
| json-ultra-compress (hybrid) | 33.5      | 6.3%  | 36.5           | 3.7              | N/A            | N/A                 |


## 📊 BENCHMARK SUMMARY

### api_responses (480.2 KB original)
- **Best compression**: Standard Brotli at 7.1%
- **vs Standard Gzip**: 13.4% better

### server_logs (716.5 KB original)
- **Best compression**: Standard Brotli at 12.2%
- **vs Standard Gzip**: 17.8% better
- **Selective decode**: 15.2% of original size

### analytics_events (1848.6 KB original)
- **Best compression**: Standard Brotli at 6.5%
- **vs Standard Gzip**: 25.3% better
- **Selective decode**: 20.6% of original size

### ecommerce_catalog (532.2 KB original)
- **Best compression**: Standard Brotli at 5.3%
- **vs Standard Gzip**: 17.1% better

## 🔍 KEY INSIGHTS

- **Hybrid codec** adapts compression strategy based on data characteristics
- **Columnar NDJSON** enables efficient selective field decoding
- **Best for structured data** with repeated field names and patterns
- **Selective decode** can reduce bandwidth by 70-90% for analytics use cases

## 💡 RECOMMENDED USE CASES

- 📊 **Analytics events**: High compression + selective field access
- 🚨 **Application logs**: Structured data with repeated patterns
- 🛒 **API responses**: JSON with nested objects and arrays
- 📈 **Time series data**: Columnar storage benefits

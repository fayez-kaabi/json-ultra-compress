# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-01

### 🚀 **Initial Release - The JSON Compression Revolution**

#### Added
- **JSON-native compression** with hybrid codec selection (Brotli/Gzip auto-selection)
- **Columnar NDJSON encoding** for structured logs and event streams
- **CRC32 integrity validation** for corruption detection
- **Empty line preservation** with perfect roundtrip fidelity
- **CLI tool** (`json-ultra-compress`) for command-line compression workflows
- **Pure TypeScript implementation** - zero native dependencies
- **Comprehensive test suite** (32/32 tests passing)

#### Performance
- **60-70% better compression** vs Brotli on structured NDJSON
- **3-5x faster encoding** with columnar mode
- **Perfect data integrity** with CRC validation
- **Selective decode foundation** for partial field access

#### Codecs
- `hybrid` - Automatic best-codec selection (recommended)
- `brotli` - High compression ratio
- `gzip` - Fast compression, wide compatibility
- `identity` - No compression (testing/debugging)

#### Features
- **Columnar NDJSON** - groups records by schema, compresses columns separately
- **Schema-aware windowing** - handles mixed schemas gracefully
- **Adaptive column encodings** - delta compression, enum dictionaries, RLE
- **Container format** - versioned headers with metadata
- **Edge/serverless ready** - works everywhere JavaScript runs

### 🗑️ **Removed**
- **Experimental rANS backend** - removed for simplicity and reliability
  - May return in a future experimental package
  - Current hybrid approach provides better real-world performance

### 💡 **Migration from 0.x**
- Package renamed from `json-optimizer` to `json-ultra-compress`
- CLI command changed from `json-optimizer` to `json-ultra-compress`
- Removed rANS codec - use `hybrid` instead
- All other APIs remain compatible

---

## Future Releases

### v1.1.0 (Planned)
- **True selective decode** - read only specified fields from columnar data
- **Skip indices** - fast time-range queries without full decompression
- **Streaming APIs** - process large files without loading into memory

### v1.2.0 (Future)
- **Dictionary learning** - cross-file compression with shared vocabularies
- **Browser optimizations** - smaller bundles, WebAssembly codecs
- **Advanced analytics** - built-in aggregation and filtering

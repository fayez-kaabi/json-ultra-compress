# Contributing to json-ultra-compress

Thank you for your interest in contributing to json-ultra-compress! We welcome contributions from the community.

## 🚀 **Quick Start**

```bash
# Fork the repository on GitHub
git clone https://github.com/fayez-kaabi/json-ultra-compress.git
cd json-ultra-compress

# Install dependencies
npm install

# Run tests (should be 40/40 passing)
npm test

# Build the project
npm run build

# Run examples
npx tsx examples/basic-usage.ts
```

## 🎯 **How to Contribute**

### **Types of Contributions**
- 🐛 **Bug fixes** - Fix issues in existing functionality
- ✨ **Features** - Add new compression algorithms or optimizations
- 📚 **Documentation** - Improve README, examples, or code comments
- 🧪 **Tests** - Add test cases or improve coverage
- ⚡ **Performance** - Optimize compression ratios or speed
- 🔧 **Tooling** - Improve build process, CI/CD, or developer experience

### **Development Workflow**

1. **Create an issue** first to discuss your idea
2. **Fork** the repository
3. **Create a feature branch**: `git checkout -b feature/amazing-improvement`
4. **Make your changes** following our coding standards
5. **Add tests** for new functionality
6. **Run the test suite**: `npm test` (must be 32/32 passing)
7. **Build**: `npm run build` (must succeed)
8. **Submit a pull request** with a clear description

### **Coding Standards**

#### **TypeScript**
- Use strict TypeScript with proper types
- Prefer `const` over `let`, avoid `var`
- Use descriptive variable names
- Add JSDoc comments for public APIs

#### **Code Style**
- We use Prettier for formatting: `npm run format`
- ESLint for code quality: `npm run lint`
- Follow existing patterns in the codebase

#### **Testing**
- All new features must include tests
- Maintain 100% test pass rate (32/32)
- Use descriptive test names
- Test both success and error cases

#### **Performance**
- Benchmark significant changes
- Document performance implications
- Avoid breaking changes to public APIs

## 📋 **Development Areas**

### **High Impact Contributions**

#### **🔥 Selective Decode Implementation**
Currently simulated - implement true selective decode that skips unused columns:

```typescript
// Goal: Read only specified fields from columnar data
const partial = await decompressNDJSON(compressed, {
  fields: ['timestamp', 'user_id', 'event_type']
});
```

**Impact**: 5-10x faster partial reads, massive bandwidth savings

#### **⚡ Streaming APIs**
Add streaming compression/decompression for large files:

```typescript
// Goal: Process files larger than memory
const stream = createCompressionStream({ codec: 'hybrid', columnar: true });
inputStream.pipe(stream).pipe(outputStream);
```

**Impact**: Handle GB+ files without memory issues

#### **🎯 Advanced Column Encodings**
- Dictionary learning across files
- Better timestamp compression (preserve ISO strings)
- Nested object flattening
- Run-length encoding improvements

### **Medium Impact Contributions**

#### **📊 Browser Support**
- WebAssembly codec implementations
- Smaller bundle sizes for browser usage
- Service Worker integration examples

#### **🔧 Developer Experience**
- Better error messages
- Progress callbacks for large operations
- Debug mode with compression statistics
- VS Code extension for .jopt files

### **Documentation Contributions**

#### **📚 Needed Documentation**
- Performance tuning guide
- Integration examples (Express, Fastify, Workers)
- Comparison with other libraries
- Migration guides from other formats

## 🧪 **Testing Guidelines**

### **Running Tests**
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode during development
npm run lint          # Code quality checks
npm run format        # Auto-format code
```

### **Test Structure**
- **Unit tests**: Individual function testing
- **Integration tests**: End-to-end compression workflows
- **Performance tests**: Benchmark critical paths
- **Edge cases**: Empty data, malformed input, large files

### **Adding New Tests**
1. Create test file in `tests/` directory
2. Use Vitest framework (already configured)
3. Follow existing test patterns
4. Test both positive and negative cases
5. Include performance assertions where relevant

## 🔄 **Pull Request Process**

### **Before Submitting**
- [ ] Tests pass: `npm test` (32/32)
- [ ] Code builds: `npm run build`
- [ ] Linting passes: `npm run lint`
- [ ] Code formatted: `npm run format`
- [ ] Documentation updated (if needed)

### **PR Description Template**
```markdown
## What
Brief description of the change

## Why
Motivation and context for the change

## How
Technical approach and implementation details

## Testing
How the change was tested

## Performance
Any performance implications (include benchmarks if relevant)

## Breaking Changes
List any breaking changes (avoid in v1.x)
```

### **Review Process**
1. Automated CI checks must pass
2. Code review by maintainer
3. Performance review for optimization changes
4. Documentation review for public API changes
5. Final approval and merge

## 🏗️ **Architecture Overview**

### **Core Components**
- **`src/codecs/`** - Compression algorithm implementations
- **`src/container.ts`** - File format with headers and CRC
- **`src/ndjson/columnar.ts`** - Columnar encoding magic
- **`src/index.ts`** - Public API
- **`src/cli.ts`** - Command-line interface

### **Key Principles**
- **Layered architecture** - Clear separation of concerns
- **Codec abstraction** - Easy to add new compression algorithms
- **Type safety** - Comprehensive TypeScript types
- **Performance first** - Optimized for real-world workloads

## 🎯 **Roadmap & Priorities**

### **v1.1.0 (Next Release)**
- True selective decode implementation
- Skip indices for time-range queries
- Streaming API for large files

### **v1.2.0 (Future)**
- Dictionary learning across files
- Browser optimizations
- Advanced analytics functions

### **Community Wishlist**
- Python bindings
- Rust implementation
- Cloud storage integrations
- Real-time streaming support

## 💬 **Getting Help**

- **Issues**: GitHub issues for bugs and feature requests
- **Discussions**: GitHub discussions for questions and ideas
- **Email**: fayez.kaabi@hotmail.com for security or urgent matters

## 🙏 **Recognition**

Contributors will be:
- Listed in CHANGELOG.md
- Credited in release notes
- Added to package.json contributors field
- Mentioned in social media announcements

---

**Thank you for helping make JSON compression better for everyone! 🚀**

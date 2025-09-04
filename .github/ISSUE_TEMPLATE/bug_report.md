---
name: Bug report
about: Create a report to help us improve json-ultra-compress
title: '[BUG] '
labels: bug
assignees: ''
---

## 🐛 **Bug Description**
A clear and concise description of what the bug is.

## 🔄 **To Reproduce**
Steps to reproduce the behavior:

1. Install json-ultra-compress: `npm install json-ultra-compress@1.0.1`
2. Run command: `json-ultra-compress compress --codec=hybrid input.json -o output.juc`
3. See error: ...

## ✅ **Expected Behavior**
A clear description of what you expected to happen.

## ❌ **Actual Behavior**
What actually happened instead.

## 📊 **Sample Data**
If possible, provide sample data that reproduces the issue:

```json
{"example": "data that causes the issue"}
```

## 🖥️ **Environment**
- **Node.js version**: [e.g. 20.12.2]
- **json-ultra-compress version**: [e.g. 1.0.1]
- **Operating System**: [e.g. Windows 11, macOS 14, Ubuntu 22.04]
- **Package manager**: [e.g. npm, yarn, pnpm]

## 📋 **Additional Context**
- Error messages (full stack trace if available)
- File sizes and compression ratios
- Performance measurements
- Any other relevant information

## 🔍 **Debugging Info**
If you can, please include:

```bash
# Version info
npm list json-ultra-compress
node --version

# Command that failed
json-ultra-compress compress-ndjson --codec=hybrid --columnar your-data.ndjson -o output.juc

# Error output
[paste full error here]
```

## 💡 **Possible Solution**
If you have ideas about what might be causing the issue or how to fix it, please share!

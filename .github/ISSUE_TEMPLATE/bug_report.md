---
name: Bug report
about: Create a report to help us improve JSONOpt
title: '[BUG] '
labels: bug
assignees: ''
---

## 🐛 **Bug Description**
A clear and concise description of what the bug is.

## 🔄 **To Reproduce**
Steps to reproduce the behavior:

1. Install JSONOpt: `npm install jsonopt@1.0.0`
2. Run command: `jsonopt compress --codec=hybrid < input.json`
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
- **JSONOpt version**: [e.g. 1.0.0]
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
npm list jsonopt
node --version

# Command that failed
jsonopt compress --codec=hybrid --columnar < your-data.ndjson

# Error output
[paste full error here]
```

## 💡 **Possible Solution**
If you have ideas about what might be causing the issue or how to fix it, please share!

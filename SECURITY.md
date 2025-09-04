# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in json-ultra-compress, please report it responsibly:

### **Preferred Method: Private Security Advisory**
1. Go to https://github.com/fayez-kaabi/json-ultra-compress/security/advisories
2. Click "Report a vulnerability"
3. Provide detailed information about the issue

### **Alternative: Email**
Send details to: fayez.kaabi@hotmail.com

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### **What to Expect**
- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Varies by severity
  - Critical: Within 24-48 hours
  - High: Within 1 week
  - Medium/Low: Next minor release

### **Security Considerations**

json-ultra-compress handles potentially untrusted data compression/decompression. Key security features:

#### **Built-in Protections**
- ✅ **CRC32 integrity validation** - Detects data corruption
- ✅ **Input validation** - Rejects malformed containers
- ✅ **Memory safety** - Pure TypeScript, no buffer overflows
- ✅ **No eval()** - No dynamic code execution

#### **Safe Usage Guidelines**
- Always validate decompressed data before use
- Use in sandboxed environments for untrusted input
- Monitor memory usage with very large inputs
- Keep dependencies updated

#### **Known Limitations**
- Large inputs may consume significant memory
- No built-in rate limiting (implement at application level)
- Compression ratio claims based on structured data (results may vary)

### **Responsible Disclosure**
We follow responsible disclosure practices:
1. Acknowledge receipt within 48 hours
2. Investigate and develop fix
3. Coordinate public disclosure timing
4. Credit security researchers (unless they prefer anonymity)

### **Security Updates**
- Security fixes are published as patch releases
- Critical vulnerabilities trigger immediate releases
- Security advisories published on GitHub
- NPM security notifications enabled

Thank you for helping keep json-ultra-compress secure! 🔒

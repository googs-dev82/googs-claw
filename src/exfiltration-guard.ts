import { logger } from './logger.js';
import { logAuditEvent } from './db.js';

// Patterns that indicate potential data exfiltration attempts
const DANGEROUS_PATTERNS = [
  // File path traversal attempts
  /(\.\.\/)+/,
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /C:\\Windows\\/,
  // SQL injection patterns
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\b.*\b(FROM|INTO|TABLE|WHERE)\b)/i,
  // Command injection
  /[;&|`$]/,
  // Base64 encoded commands
  /^[A-Za-z0-9+/]{20,}={0,2}$/,
  // URL with suspicious schemes
  /^(javascript|data|vbscript):/i,
  // IP address in unusual contexts
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/,
];

// Sensitive data patterns to redact
const SENSITIVE_PATTERNS = [
  // API keys (generic)
  /([aA][pP][iI]_?[kK][eE][yY]\s*[:=]\s*['"]?[\w-]{20,}['"]?)/g,
  // AWS keys
  /(AKIA[0-9A-Z]{16})/g,
  // Private keys
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  // JWT tokens
  /(eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)/g,
  // Passwords in URLs
  /(:\/\/[^:]+:)[^@]+(@)/g,
  // Social Security Numbers
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Credit card numbers
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
];

export interface ExfiltrationCheckResult {
  safe: boolean;
  issues: string[];
  redacted: string;
}

/**
 * Check content for potential exfiltration attempts
 */
export function checkExfiltration(content: string): ExfiltrationCheckResult {
  const issues: string[] = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`Dangerous pattern detected: ${pattern.source}`);
    }
  }

  // Base64 secret scanning
  const base64Regex = /(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
  const base64Matches = content.match(base64Regex) || [];
  for (const match of base64Matches) {
    try {
      const decoded = Buffer.from(match, 'base64').toString('utf8');
      for (const pattern of SENSITIVE_PATTERNS) {
        // Reset lastIndex for global regexes
        pattern.lastIndex = 0;
        if (pattern.test(decoded)) {
          issues.push(`Sensitive data found in Base64 encoded string: ${pattern.source}`);
          break;
        }
      }
    } catch (e) {
      // Ignore invalid base64
    }
  }

  // URL-encoded secret scanning
  const urlEncodedRegex = /(?:%[0-9A-Fa-f]{2})+/g;
  const urlEncodedMatches = content.match(urlEncodedRegex) || [];
  for (const match of urlEncodedMatches) {
    if (match.length > 20) { // Only check sufficiently long encoded strings
      try {
        const decoded = decodeURIComponent(match);
        for (const pattern of SENSITIVE_PATTERNS) {
          // Reset lastIndex for global regexes
          pattern.lastIndex = 0;
          if (pattern.test(decoded)) {
            issues.push(`Sensitive data found in URL-encoded string: ${pattern.source}`);
            break;
          }
        }
      } catch (e) {
        // Ignore invalid URL encoding
      }
    }
  }

  return {
    safe: issues.length === 0,
    issues,
    redacted: content,
  };
}

/**
 * Redact sensitive information from content
 */
export function redactSensitiveData(content: string): string {
  let redacted = content;

  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }

  return redacted;
}

/**
 * Validate file path to prevent directory traversal
 */
export function validateFilePath(filePath: string, allowedDir: string): {
  valid: boolean;
  resolvedPath: string;
} {
  const { resolve, join, relative } = require('path');
  
  const resolved = resolve(allowedDir, filePath);
  const relativePath = relative(allowedDir, resolved);
  
  // Check if resolved path is outside allowed directory
  if (relativePath.startsWith('..') || relativePath.includes('..')) {
    logAuditEvent('path_traversal_attempt', filePath);
    return { valid: false, resolvedPath: '' };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Check for prompt injection attempts
 */
export function checkPromptInjection(content: string): {
  suspicious: boolean;
  indicators: string[];
} {
  const indicators: string[] = [];
  
  const injectionPatterns = [
    /ignore (?:all )?(?:previous|prior|above) (?:instructions?|rules?)/i,
    /forget (?:everything|all) (?:you|that) (?:know|were told)/i,
    /new (?:system )?instructions?:/i,
    /you are now? (?:in |)(?:a |)different (?:mode|persona|role)/i,
    /disregard (?:your |)safety/i,
    /override (?:your |)(?:restrictions?|guidelines?)/i,
    /\[SYSTEM\]/i,
    /\[INST\]/i,
    /<\|system\|>/i,
    /<\|user\|>/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(content)) {
      indicators.push(`Potential injection: ${pattern.source}`);
    }
  }

  return {
    suspicious: indicators.length > 0,
    indicators,
  };
}

/**
 * Log exfiltration attempt
 */
export function logExfiltrationAttempt(
  type: string,
  content: string,
  userId?: string
): void {
  const redacted = redactSensitiveData(content);
  logAuditEvent('exfiltration_attempt', `${type}: ${redacted.slice(0, 200)}`, userId);
  logger.warn({ type, userId, contentLength: content.length }, 'Exfiltration attempt detected');
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  let sanitized = input;
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Trim to reasonable length
  if (sanitized.length > 10000) {
    sanitized = sanitized.slice(0, 10000);
  }

  return sanitized.trim();
}

/**
 * Check URL safety
 */
export function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Block dangerous protocols
    const blockedProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    if (blockedProtocols.includes(parsed.protocol)) {
      return false;
    }
    
    // Block private IP addresses
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || 
        hostname.startsWith('127.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.')) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get exfiltration guard status
 */
export function getGuardStatus(): {
  dangerousPatterns: number;
  sensitivePatterns: number;
} {
  return {
    dangerousPatterns: DANGEROUS_PATTERNS.length,
    sensitivePatterns: SENSITIVE_PATTERNS.length,
  };
}
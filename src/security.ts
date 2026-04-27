import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { logAuditEvent } from './db.js';

const env = readEnvFile();
const ALLOWED_TELEGRAM_IDS = (env['ALLOWED_TELEGRAM_IDS'] ?? '').split(',').filter(Boolean);
const BLOCKED_TELEGRAM_IDS = (env['BLOCKED_TELEGRAM_IDS'] ?? '').split(',').filter(Boolean);
const RATE_LIMIT_PER_MINUTE = parseInt(env['RATE_LIMIT_PER_MINUTE'] ?? '20', 10);
const RATE_LIMIT_PER_HOUR = parseInt(env['RATE_LIMIT_PER_HOUR'] ?? '200', 10);

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const messageTimestamps = new Map<string, number[]>();

/**
 * Check if user is authorized
 */
export function isAuthorized(userId: string, platform: string = 'telegram'): boolean {
  // If allowlist is configured, only those users are allowed
  if (ALLOWED_TELEGRAM_IDS.length > 0) {
    return ALLOWED_TELEGRAM_IDS.includes(userId);
  }

  // If blocklist is configured, check if user is blocked
  if (BLOCKED_TELEGRAM_IDS.length > 0) {
    return !BLOCKED_TELEGRAM_IDS.includes(userId);
  }

  // No restrictions
  return true;
}

/**
 * Check rate limit for user
 */
export function checkRateLimit(userId: string): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const now = Date.now();
  const minuteKey = `minute:${userId}`;
  const hourKey = `hour:${userId}`;

  // Check minute limit
  let minuteEntry = rateLimits.get(minuteKey);
  if (!minuteEntry || now > minuteEntry.resetAt) {
    minuteEntry = { count: 0, resetAt: now + 60000 };
    rateLimits.set(minuteKey, minuteEntry);
  }

  // Check hour limit
  let hourEntry = rateLimits.get(hourKey);
  if (!hourEntry || now > hourEntry.resetAt) {
    hourEntry = { count: 0, resetAt: now + 3600000 };
    rateLimits.set(hourKey, hourEntry);
  }

  const minuteRemaining = RATE_LIMIT_PER_MINUTE - minuteEntry.count;
  const hourRemaining = RATE_LIMIT_PER_HOUR - hourEntry.count;

  if (minuteEntry.count >= RATE_LIMIT_PER_MINUTE || hourEntry.count >= RATE_LIMIT_PER_HOUR) {
    logAuditEvent('rate_limit_exceeded', `User: ${userId}`, userId);
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.min(minuteEntry.resetAt - now, hourEntry.resetAt - now),
    };
  }

  minuteEntry.count++;
  hourEntry.count++;

  return {
    allowed: true,
    remaining: Math.min(minuteRemaining, hourRemaining),
    resetIn: minuteEntry.resetAt - now,
  };
}

/**
 * Record message for rate limiting
 */
export function recordMessage(userId: string): void {
  const now = Date.now();
  const timestamps = messageTimestamps.get(userId) ?? [];
  timestamps.push(now);
  
  // Keep only last hour of timestamps
  const cutoff = now - 3600000;
  const recent = timestamps.filter(t => t > cutoff);
  
  messageTimestamps.set(userId, recent);
}

/**
 * Get message frequency for user
 */
export function getMessageFrequency(userId: string): number {
  const timestamps = messageTimestamps.get(userId) ?? [];
  const now = Date.now();
  const cutoff = now - 60000;
  return timestamps.filter(t => t > cutoff).length;
}

/**
 * Validate message content
 */
export function validateMessageContent(content: string): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  // Check for empty message
  if (!content.trim()) {
    issues.push('Empty message');
  }

  // Check for very long messages
  if (content.length > 4000) {
    issues.push('Message too long (max 4000 chars)');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Log security event
 */
export function logSecurityEvent(
  eventType: string,
  details: string,
  userId?: string
): void {
  logAuditEvent(eventType, details, userId);
  logger.warn({ eventType, details, userId }, 'Security event');
}

/**
 * Check if user is suspicious
 */
export function isSuspicious(userId: string): boolean {
  const frequency = getMessageFrequency(userId);
  
  // More than 10 messages per minute is suspicious
  if (frequency > 10) {
    logSecurityEvent('suspicious_activity', `High message frequency: ${frequency}/min`, userId);
    return true;
  }

  return false;
}

/**
 * Get security status for user
 */
export function getSecurityStatus(userId: string): {
  authorized: boolean;
  rateLimited: boolean;
  suspicious: boolean;
  messageCount: number;
} {
  return {
    authorized: isAuthorized(userId),
    rateLimited: !checkRateLimit(userId).allowed,
    suspicious: isSuspicious(userId),
    messageCount: messageTimestamps.get(userId)?.length ?? 0,
  };
}

/**
 * Get overall security statistics
 */
export function getSecurityStats() {
  return {
    authorizedUsers: ALLOWED_TELEGRAM_IDS.length,
    blockedUsers: BLOCKED_TELEGRAM_IDS.length,
    rateLimited: rateLimits.size,
  };
}

/**
 * Reset rate limits (for testing)
 */
export function resetRateLimits(userId?: string): void {
  if (userId) {
    rateLimits.delete(`minute:${userId}`);
    rateLimits.delete(`hour:${userId}`);
    messageTimestamps.delete(userId);
  } else {
    rateLimits.clear();
    messageTimestamps.clear();
  }
}

/**
 * Get blocked users list
 */
export function getBlockedUsers(): string[] {
  return [...BLOCKED_TELEGRAM_IDS];
}

/**
 * Get allowed users list
 */
export function getAllowedUsers(): string[] {
  return [...ALLOWED_TELEGRAM_IDS];
}

/**
 * Add user to blocklist
 */
export function blockUser(userId: string): void {
  if (!BLOCKED_TELEGRAM_IDS.includes(userId)) {
    BLOCKED_TELEGRAM_IDS.push(userId);
    logSecurityEvent('user_blocked', `User added to blocklist: ${userId}`);
  }
}

/**
 * Remove user from blocklist
 */
export function unblockUser(userId: string): void {
  const index = BLOCKED_TELEGRAM_IDS.indexOf(userId);
  if (index > -1) {
    BLOCKED_TELEGRAM_IDS.splice(index, 1);
    logSecurityEvent('user_unblocked', `User removed from blocklist: ${userId}`);
  }
}
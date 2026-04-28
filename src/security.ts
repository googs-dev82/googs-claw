import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { logAuditEvent } from './db.js';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const env = readEnvFile();
const ALLOWED_TELEGRAM_IDS = (env['ALLOWED_TELEGRAM_IDS'] ?? '').split(',').filter(Boolean);
const BLOCKED_TELEGRAM_IDS = (env['BLOCKED_TELEGRAM_IDS'] ?? '').split(',').filter(Boolean);
const RATE_LIMIT_PER_MINUTE = parseInt(env['RATE_LIMIT_PER_MINUTE'] ?? '20', 10);
const RATE_LIMIT_PER_HOUR = parseInt(env['RATE_LIMIT_PER_HOUR'] ?? '200', 10);

const SYSTEM_PIN_HASH = env['SYSTEM_PIN_HASH'] || '';
const SYSTEM_PIN_SALT = env['SYSTEM_PIN_SALT'] || '';
const IDLE_AUTO_LOCK_MINUTES = parseInt(env['IDLE_AUTO_LOCK_MINUTES'] ?? '30', 10);
const EMERGENCY_KILL_PHRASE = env['EMERGENCY_KILL_PHRASE'] || 'ABORT_SYSTEM_NOW';

const MESSAGE_ENCRYPTION_KEY = env['MESSAGE_ENCRYPTION_KEY'] || '';
if (MESSAGE_ENCRYPTION_KEY && MESSAGE_ENCRYPTION_KEY.length !== 64) {
  logger.warn('MESSAGE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Encryption may fail.');
}

import { writeFileSync } from 'fs';

let systemLocked = false;
let lastActivityTimestamp = Date.now();
let killSwitchEngaged = false;

/**
 * Synchronize the system lock state with the War Room Pipecat server
 */
function syncPinState() {
  try {
    writeFileSync('/tmp/warroom-pin.json', JSON.stringify({ locked: systemLocked, pinned: false }));
  } catch (error) {
    // ignore
  }
}

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

  // Secret scanning for Base64 encoded strings that might look like keys/tokens
  const base64Regex = /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
  if (base64Regex.test(content)) {
    issues.push('Potential Base64 encoded secret detected');
  }

  // URL token/secret scanning
  const urlTokenRegex = /(?:api_key|token|secret|password|bearer|auth)[=:][a-zA-Z0-9_\-\.\%]{10,}/gi;
  if (urlTokenRegex.test(content)) {
    issues.push('Potential API token or secret detected');
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

/**
 * Verify PIN and unlock system
 */
export function verifyPin(pin: string): boolean {
  if (killSwitchEngaged) {
    logger.warn('System kill switch is engaged. Cannot unlock.');
    return false;
  }
  
  if (!SYSTEM_PIN_HASH || !SYSTEM_PIN_SALT) {
    // If no PIN configured, unlocking is not permitted via this method,
    // or maybe defaults to true? We will enforce strict security: if not configured, no lock bypass
    return false;
  }

  const hash = createHash('sha256')
    .update(pin + SYSTEM_PIN_SALT)
    .digest('hex');
    
  if (hash === SYSTEM_PIN_HASH) {
    systemLocked = false;
    syncPinState();
    lastActivityTimestamp = Date.now();
    logSecurityEvent('system_unlocked', 'System unlocked via PIN');
    return true;
  }
  
  logSecurityEvent('pin_failure', 'Invalid PIN attempt');
  return false;
}

/**
 * Manually lock system
 */
export function lockSystem(): void {
  systemLocked = true;
  syncPinState();
  logSecurityEvent('system_locked', 'System locked manually');
}

/**
 * Check if the system is currently locked
 * Also handles idle auto-lock logic
 */
export function isSystemLocked(): boolean {
  if (killSwitchEngaged) return true;
  
  if (!systemLocked) {
    const idleMinutes = (Date.now() - lastActivityTimestamp) / 60000;
    if (IDLE_AUTO_LOCK_MINUTES > 0 && idleMinutes >= IDLE_AUTO_LOCK_MINUTES) {
      systemLocked = true;
      syncPinState();
      logSecurityEvent('system_locked', `System locked automatically after ${IDLE_AUTO_LOCK_MINUTES} minutes of inactivity`);
    }
  }
  return systemLocked;
}

/**
 * Record activity to prevent idle auto-lock
 */
export function recordActivity(): void {
  lastActivityTimestamp = Date.now();
}

/**
 * Check for emergency kill phrase and engage kill switch if found
 */
export function checkKillPhrase(content: string, userId: string): boolean {
  if (EMERGENCY_KILL_PHRASE && content.includes(EMERGENCY_KILL_PHRASE)) {
    killSwitchEngaged = true;
    systemLocked = true;
    syncPinState();
    logSecurityEvent('kill_switch_engaged', 'Emergency kill phrase activated', userId);
    return true;
  }
  return false;
}

/**
 * Generate a new salted SHA-256 PIN hash for configuration (utility)
 */
export function generatePinHash(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256')
    .update(pin + salt)
    .digest('hex');
  return { salt, hash };
}

/**
 * Encrypt a string field using AES-256-GCM
 * Returns a base64 encoded string containing the IV, auth tag, and encrypted data: "iv:authTag:encryptedData"
 */
export function encryptField(text: string): string {
  if (!MESSAGE_ENCRYPTION_KEY || !text) return text;
  
  try {
    const key = Buffer.from(MESSAGE_ENCRYPTION_KEY, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    
    return `${iv.toString('base64')}:${authTag}:${encrypted}`;
  } catch (error) {
    logger.error({ error }, 'Encryption failed');
    return text;
  }
}

/**
 * Decrypt a string field using AES-256-GCM
 * Expects input format: "iv:authTag:encryptedData"
 */
export function decryptField(encryptedText: string): string {
  if (!MESSAGE_ENCRYPTION_KEY || !encryptedText || !encryptedText.includes(':')) return encryptedText;
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    
    const [ivBase64, authTagBase64, encryptedBase64] = parts;
    const key = Buffer.from(MESSAGE_ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error({ error }, 'Decryption failed');
    return encryptedText;
  }
}
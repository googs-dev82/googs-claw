import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

/**
 * Parse a .env file without polluting process.env.
 * @param keys - Optional list of keys to return. If not provided, returns all keys.
 * @returns Record of env var key-value pairs
 */
export function readEnvFile(keys?: string[]): Record<string, string> {
  const envPath = join(PROJECT_ROOT, '.env');
  
  if (!existsSync(envPath)) {
    return {};
  }
  
  const content = readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Find the first = sign
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    
    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    // If specific keys requested, only include those
    if (keys && !keys.includes(key)) {
      continue;
    }
    
    result[key] = value;
  }
  
  return result;
}

export { PROJECT_ROOT };
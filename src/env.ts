import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { basename, dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const PROJECT_ROOT = basename(packageRoot) === 'dist' ? join(packageRoot, '..') : packageRoot;

/**
 * Parse a .env file without polluting process.env.
 * @param keys - Optional list of keys to return. If not provided, returns all keys.
 * @returns Record of env var key-value pairs
 */
export function readEnvFile(keys?: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  
  const envPaths = [
    join(PROJECT_ROOT, '.env')
  ];
  
  // Support external configuration directory
  const externalConfigDir = process.env['CLAUDECLAW_CONFIG'];
  if (externalConfigDir) {
    envPaths.push(join(externalConfigDir, '.env'));
  }

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }
    
    const content = readFileSync(envPath, 'utf-8');
    
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
  }
  
  // Also blend in actual process.env for variables explicitly set in environment
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && (!keys || keys.includes(k))) {
      result[k] = v;
    }
  }

  return result;
}

export { PROJECT_ROOT };

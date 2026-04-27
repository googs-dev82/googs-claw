#!/usr/bin/env node

import { readEnvFile } from './env.js';
import { initDatabase, getAllMemories, getMemoryStats, getTokenUsageStats } from './db.js';
import { logger } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

interface SetupOptions {
  skipInstall?: boolean;
  skipDb?: boolean;
  skipEnv?: boolean;
  verbose?: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const options: SetupOptions = {
    skipInstall: args.includes('--skip-install'),
    skipDb: args.includes('--skip-db'),
    skipEnv: args.includes('--skip-env'),
    verbose: args.includes('--verbose'),
  };

  console.log('\n🔧 ClaudeClaw Setup\n');
  console.log('='.repeat(40));

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].replace('v', ''));
  
  if (majorVersion < 20) {
    console.error(`\n❌ Node.js 20+ required. Current: ${nodeVersion}`);
    console.error('   Please upgrade: https://nodejs.org/\n');
    process.exit(1);
  }
  
  console.log(`✅ Node.js: ${nodeVersion}`);

  // Check npm
  try {
    const { execSync } = await import('child_process');
    const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    console.log(`✅ npm: ${npmVersion}`);
  } catch {
    console.error('❌ npm not found');
    process.exit(1);
  }

  // Install dependencies
  if (!options.skipInstall) {
    console.log('\n📦 Installing dependencies...');
    try {
      const { execSync } = await import('child_process');
      execSync('npm install', { 
        cwd: projectRoot,
        stdio: options.verbose ? 'inherit' : 'pipe'
      });
      console.log('   ✅ Dependencies installed');
    } catch (error) {
      console.error('   ❌ Failed to install dependencies');
      if (options.verbose) console.error(error);
      process.exit(1);
    }
  } else {
    console.log('\n⏭️  Skipping dependency installation');
  }

  // Initialize database
  if (!options.skipDb) {
    console.log('\n🗄️  Initializing database...');
    try {
      initDatabase();
      console.log('   ✅ Database initialized');
    } catch (error) {
      console.error('   ❌ Failed to initialize database');
      if (options.verbose) console.error(error);
      process.exit(1);
    }
  } else {
    console.log('\n⏭️  Skipping database initialization');
  }

  // Check/create .env file
  if (!options.skipEnv) {
    console.log('\n🔐 Checking environment configuration...');
    const envPath = path.join(projectRoot, '.env');
    const envExamplePath = path.join(projectRoot, '.env.example');
    
    if (!fs.existsSync(envPath)) {
      if (fs.existsSync(envExamplePath)) {
        fs.copyFileSync(envExamplePath, envPath);
        console.log('   ✅ Created .env from template');
        console.log('   ⚠️  Please edit .env and add your API keys');
      } else {
        // Create basic .env
        const basicEnv = `# ClaudeClaw Environment Configuration
# Get these from respective platforms

# Telegram (https://my.telegram.org)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_BOT_TOKEN=

# Anthropic (https://anthropic.com)
ANTHROPIC_API_KEY=

# Google Calendar (for meeting scheduling)
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_TIMEZONE=Asia/Riyadh
GOOGLE_CALENDAR_ACCESS_TOKEN=
GOOGLE_CALENDAR_REFRESH_TOKEN=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=

# Google (https://aistudio.google.com/app/apikey)
GOOGLE_API_KEY=

# Groq (https://console.groq.com)
GROQ_API_KEY=
`;
        fs.writeFileSync(envPath, basicEnv);
        console.log('   ✅ Created .env file');
        console.log('   ⚠️  Please edit .env and add your API keys');
      }
    } else {
      console.log('   ✅ .env exists');
    }

    // Check critical env vars
    const env = readEnvFile();
    const missing: string[] = [];
    
    if (!env['TELEGRAM_API_ID']) missing.push('TELEGRAM_API_ID');
    if (!env['TELEGRAM_API_HASH']) missing.push('TELEGRAM_API_HASH');
    if (!env['TELEGRAM_BOT_TOKEN']) missing.push('TELEGRAM_BOT_TOKEN');
    if (!env['ANTHROPIC_API_KEY']) missing.push('ANTHROPIC_API_KEY');
    if (!env['GOOGLE_API_KEY']) missing.push('GOOGLE_API_KEY');
    
    if (missing.length > 0) {
      console.log(`\n   ⚠️  Missing required variables: ${missing.join(', ')}`);
    } else {
      console.log('   ✅ All required variables set');
    }
  } else {
    console.log('\n⏭️  Skipping env check');
  }

  // Build project
  console.log('\n🔨 Building project...');
  try {
    const { execSync } = await import('child_process');
    execSync('npm run build', { 
      cwd: projectRoot,
      stdio: options.verbose ? 'inherit' : 'pipe'
    });
    console.log('   ✅ Build successful');
  } catch (error) {
    console.error('   ❌ Build failed');
    if (options.verbose) console.error(error);
    process.exit(1);
  }

  // Print summary
  console.log('\n' + '='.repeat(40));
  console.log('\n🎉 Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Edit .env and add your API keys');
  console.log('2. Run: npm start');
  console.log('3. Start a chat with your Telegram bot\n');
}

main().catch(error => {
  logger.error({ error }, 'Setup error');
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

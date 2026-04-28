import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { initDatabase } from './db.js';
import { initTelegram, getTelegramStatus } from './bot.js';
import { initWhatsApp } from './whatsapp.js';
import { initSlack } from './slack.js';
import { startDashboard } from './dashboard.js';
import { startScheduler } from './scheduler.js';
import { startConsolidationLoop } from './memory-consolidate.js';
import { initWarRoomBridge } from './agent-voice-bridge.js';
import { runMemoryDecaySweep } from './memory.js';

const env = readEnvFile();

/**
 * Main entry point for ClaudeClaw
 */
async function main() {
  const agentId = parseAgentId(process.argv.slice(2));
  if (agentId) {
    process.env['CLAUDECLAW_AGENT_ID'] = agentId;
    process.env['AGENT_ID'] = agentId;
  }

  logger.info('Starting ClaudeClaw OS v2...');
  console.log(`\n🤖 ClaudeClaw OS v2${agentId ? ` - Agent: ${agentId}` : ''}\n`);

  // Initialize database
  console.log('📦 Initializing database...');
  initDatabase();
  console.log('   ✅ Database ready\n');

  // Initialize Telegram
  const telegramEnabled = env['TELEGRAM_ENABLED']?.toLowerCase() !== 'false';
  if (telegramEnabled) {
    console.log('📱 Connecting to Telegram...');
    try {
      await initTelegram();
      console.log('   ✅ Telegram connected\n');
    } catch (error) {
      console.error('   ❌ Telegram connection failed:', error);
    }
  }

  // Initialize WhatsApp
  const whatsappEnabled = env['WHATSAPP_ENABLED']?.toLowerCase() === 'true' && !agentId;
  if (whatsappEnabled) {
    console.log('💬 Connecting to WhatsApp...');
    try {
      await initWhatsApp();
      console.log('   ✅ WhatsApp connected\n');
    } catch (error) {
      console.error('   ❌ WhatsApp connection failed:', error);
    }
  }

  // Initialize Slack
  const slackEnabled = env['SLACK_ENABLED']?.toLowerCase() === 'true' && !agentId;
  if (slackEnabled) {
    console.log('💼 Connecting to Slack...');
    try {
      await initSlack();
      console.log('   ✅ Slack connected\n');
    } catch (error) {
      console.error('   ❌ Slack connection failed:', error);
    }
  }

  // Start dashboard
  const dashboardEnabled = env['DASHBOARD_ENABLED']?.toLowerCase() !== 'false' && !agentId;
  if (dashboardEnabled) {
    console.log('📊 Starting dashboard...');
    startDashboard();
    console.log('   ✅ Dashboard ready\n');
  }

  // Start scheduler
  const schedulerEnabled = env['SCHEDULER_ENABLED']?.toLowerCase() !== 'false' && !agentId;
  if (schedulerEnabled) {
    console.log('⏰ Starting scheduler...');
    startScheduler();
    console.log('   ✅ Scheduler running\n');
  }

  // Start memory consolidation
  const consolidationEnabled = env['MEMORY_CONSOLIDATION_ENABLED']?.toLowerCase() !== 'false' && !agentId;
  if (consolidationEnabled) {
    console.log('🧠 Starting memory consolidation...');
    startConsolidationLoop();
    console.log('   ✅ Memory consolidation active\n');
  }

  // Initialize War Room bridge
  const warroomEnabled = env['WARROOM_ENABLED']?.toLowerCase() === 'true' && !agentId;
  if (warroomEnabled) {
    console.log('🎙️ Initializing War Room bridge...');
    initWarRoomBridge();
    console.log('   ✅ War Room bridge ready\n');
  }

  // Run initial memory decay sweep
  const memoryDecayEnabled = env['MEMORY_DECAY_ENABLED']?.toLowerCase() !== 'false' && !agentId;
  if (memoryDecayEnabled) {
    console.log('🔄 Running initial memory decay sweep...');
    await runMemoryDecaySweep();
    console.log('   ✅ Memory decay sweep complete\n');
  }

  // Print status
  console.log('='.repeat(50));
  console.log('\n🎉 ClaudeClaw is ready!\n');
  
  const tgStatus = getTelegramStatus();
  console.log(`📱 Telegram: ${tgStatus.ready ? '✅ Connected' : '❌ Not connected'}`);
  console.log(`💬 WhatsApp: ${whatsappEnabled ? (env['WA_SESSION_PATH'] ? '✅ Configured' : '⏳ QR Code needed') : '❌ Disabled'}`);
  console.log(`💼 Slack:    ${slackEnabled ? '✅ Configured' : '❌ Disabled'}`);
  console.log(`📊 Dashboard: ${dashboardEnabled ? '✅ Running' : '❌ Disabled'}`);
  console.log(`⏰ Scheduler: ${schedulerEnabled ? '✅ Running' : '❌ Disabled'}`);
  console.log(`🎙️ War Room:  ${warroomEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  
  const dashUrl = env['DASHBOARD_URL'] || 'http://localhost:3141';
  console.log(`\n🌐 Dashboard: ${dashUrl}`);
  console.log('\n' + '='.repeat(50) + '\n');

  // Handle graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function parseAgentId(args: string[]): string | null {
  const inlineFlag = args.find((arg) => arg.startsWith('--agent='));
  if (inlineFlag) {
    return inlineFlag.slice('--agent='.length).trim() || null;
  }

  const flagIndex = args.indexOf('--agent');
  if (flagIndex >= 0) {
    return args[flagIndex + 1]?.trim() || null;
  }

  return process.env['CLAUDECLAW_AGENT_ID'] || process.env['AGENT_ID'] || null;
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  logger.info('Shutting down ClaudeClaw...');
  console.log('\n👋 Shutting down...');
  
  // Stop scheduler
  const { stopScheduler } = await import('./scheduler.js');
  stopScheduler();
  
  // Stop Telegram
  const { stopTelegram } = await import('./bot.js');
  await stopTelegram();
  
  // Stop WhatsApp
  const { disconnectWhatsApp } = await import('./whatsapp.js');
  await disconnectWhatsApp();
  
  // Stop Slack
  const { stopSlack } = await import('./slack.js');
  await stopSlack();
  
  // Disconnect War Room
  const { disconnectFromWarRoom } = await import('./agent-voice-bridge.js');
  disconnectFromWarRoom();
  
  console.log('✅ Shutdown complete\n');
  process.exit(0);
}

// Start the application
main().catch(error => {
  logger.error({ error }, 'Fatal error');
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

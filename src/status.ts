#!/usr/bin/env node

import { getTelegramStatus } from './bot.js';
import { getWhatsAppStatus } from './whatsapp.js';
import { getSlackStatus } from './slack.js';
import { getSchedulerStatus } from './scheduler.js';
import { getVoiceHealthStatus } from './voice.js';
import { getSecurityStats } from './security.js';
import { getMemoryStats, getTokenUsageStats } from './db.js';
import { logger } from './logger.js';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  switch (command) {
    case 'status':
      await showStatus();
      break;
    case 'watch':
      await watchStatus();
      break;
    case 'test':
      await testConnections();
      break;
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Usage: status.ts [status|watch|test]');
  }

  rl.close();
}

async function showStatus() {
  console.log('\n🤖 ClaudeClaw Status\n');
  console.log('='.repeat(50));

  // Platform status
  console.log('\n📱 Platforms:');
  const tgStatus = getTelegramStatus();
  console.log(`   Telegram:  ${tgStatus.ready ? '✅ Connected' : '❌ Disconnected'}`);
  
  const waStatus = getWhatsAppStatus();
  console.log(`   WhatsApp:  ${waStatus.ready ? '✅ Connected' : waStatus.initialized ? '⏳ Connecting...' : '❌ Disconnected'}`);
  
  const slackStatus = getSlackStatus();
  console.log(`   Slack:     ${slackStatus.ready ? '✅ Connected' : slackStatus.initialized ? '⏳ Connecting...' : '❌ Disconnected'}`);

  // Scheduler
  console.log('\n⏰ Scheduler:');
  const schedStatus = getSchedulerStatus();
  console.log(`   Status:    ${schedStatus.running ? '✅ Running' : '❌ Stopped'}`);
  console.log(`   Tasks:     ${schedStatus.totalTasks} total, ${schedStatus.dueTasks} due`);

  // Voice
  console.log('\n🎤 Voice:');
  const voiceStatus = await getVoiceHealthStatus();
  console.log(`   STT:       ${voiceStatus.stt ? '✅ Healthy' : '❌ Error'}`);
  console.log(`   TTS:       ${voiceStatus.tts ? '✅ Healthy' : '❌ Error'}`);
  console.log(`   Overall:   ${voiceStatus.overall}`);

  // Memory
  console.log('\n🧠 Memory:');
  const memStats = getMemoryStats();
  console.log(`   Total:     ${memStats.total}`);
  console.log(`   Consolidations: ${memStats.consolidated}`);

  // Security
  console.log('\n🔐 Security:');
  const secStats = getSecurityStats();
  console.log(`   Authorized: ${secStats.authorizedUsers}`);
  console.log(`   Blocked:    ${secStats.blockedUsers}`);
  console.log(`   Rate Limited: ${secStats.rateLimited}`);

  // Tokens
  console.log('\n💰 Token Usage:');
  const tokenStats = getTokenUsageStats();
  console.log(`   Input:     ${tokenStats.promptTokens.toLocaleString()}`);
  console.log(`   Output:    ${tokenStats.completionTokens.toLocaleString()}`);
  console.log(`   Cost:      $${tokenStats.estimatedCost.toFixed(4)}`);

  console.log('\n' + '='.repeat(50) + '\n');
}

async function watchStatus() {
  console.log('\n🔄 Watching status (Ctrl+C to stop)...\n');
  
  setInterval(async () => {
    // Clear screen (cross-platform)
    console.clear();
    
    const schedStatus = getSchedulerStatus();
    const memStats = getMemoryStats();
    const tokenStats = getTokenUsageStats();
    
    console.log(`\n🤖 ClaudeClaw Status - ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(50));
    console.log(`Scheduler: ${schedStatus.running ? '✅' : '❌'} | Tasks: ${schedStatus.totalTasks} | Due: ${schedStatus.dueTasks}`);
    console.log(`Memory: ${memStats.total} | Consolidated: ${memStats.consolidated}`);
    console.log(`Tokens: ${tokenStats.totalTokens} | Cost: $${tokenStats.estimatedCost.toFixed(4)}`);
    console.log('='.repeat(50));
  }, 5000);

  // Initial display
  await showStatus();
}

async function testConnections() {
  console.log('\n🧪 Testing connections...\n');
  
  // Test Telegram
  console.log('📱 Testing Telegram...');
  const tgStatus = getTelegramStatus();
  console.log(`   ${tgStatus.ready ? '✅' : '❌'} Telegram ${tgStatus.ready ? 'connected' : 'not connected'}`);
  
  // Test WhatsApp
  console.log('💬 Testing WhatsApp...');
  const waStatus = getWhatsAppStatus();
  console.log(`   ${waStatus.ready ? '✅' : waStatus.initialized ? '⏳' : '❌'} WhatsApp ${waStatus.ready ? 'connected' : waStatus.initialized ? 'connecting' : 'not connected'}`);
  
  // Test Slack
  console.log('💼 Testing Slack...');
  const slackStatus = getSlackStatus();
  console.log(`   ${slackStatus.ready ? '✅' : slackStatus.initialized ? '⏳' : '❌'} Slack ${slackStatus.ready ? 'connected' : slackStatus.initialized ? 'connecting' : 'not connected'}`);
  
  // Test Voice
  console.log('🎤 Testing Voice...');
  const voiceStatus = await getVoiceHealthStatus();
  console.log(`   ${voiceStatus.stt ? '✅' : '❌'} STT ${voiceStatus.stt ? 'healthy' : 'error'}`);
  console.log(`   ${voiceStatus.tts ? '✅' : '❌'} TTS ${voiceStatus.tts ? 'healthy' : 'error'}`);
  
  console.log('\n✅ Connection tests complete\n');
}

main().catch(error => {
  logger.error({ error }, 'Status error');
  console.error(error);
  rl.close();
  process.exit(1);
});

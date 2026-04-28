import { createInterface } from 'readline';
import { saveAgentConfigToDb, AgentConfig } from './agent-config.js';
import { logger } from './logger.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { PROJECT_ROOT } from './env.js';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => 
  new Promise(resolve => rl.question(query, resolve));

async function validateTelegramToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    return false;
  }
}

function generateLaunchdPlist(agentId: string) {
  const plistPath = join(process.env.HOME || '', 'Library', 'LaunchAgents', `com.claudeclaw.agent.${agentId}.plist`);
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claudeclaw.agent.${agentId}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${join(PROJECT_ROOT, 'dist', 'src', 'index.js')}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENT_ID</key>
        <string>${agentId}</string>
        <key>PROJECT_ROOT_DIR</key>
        <string>${PROJECT_ROOT}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${join(PROJECT_ROOT, 'logs', `${agentId}.err`)}</string>
    <key>StandardOutPath</key>
    <string>${join(PROJECT_ROOT, 'logs', `${agentId}.out`)}</string>
</dict>
</plist>`;

  try {
    const launchAgentsDir = dirname(plistPath);
    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
    }
    writeFileSync(plistPath, plistContent, 'utf-8');
    console.log(`✅ Generated Launchd plist: ${plistPath}`);
    console.log(`   To load: launchctl load ${plistPath}`);
  } catch (e) {
    console.error(`❌ Failed to write Launchd plist: ${e}`);
  }
}

function generateSystemdService(agentId: string) {
  const servicePath = join(process.env.HOME || '', '.config', 'systemd', 'user', `claudeclaw-agent-${agentId}.service`);
  const serviceContent = `[Unit]
Description=ClaudeClaw Agent - ${agentId}
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${join(PROJECT_ROOT, 'dist', 'src', 'index.js')}
WorkingDirectory=${PROJECT_ROOT}
Environment=AGENT_ID=${agentId}
Environment=PROJECT_ROOT_DIR=${PROJECT_ROOT}
Restart=always
RestartSec=10
StandardOutput=append:${join(PROJECT_ROOT, 'logs', `${agentId}.out`)}
StandardError=append:${join(PROJECT_ROOT, 'logs', `${agentId}.err`)}

[Install]
WantedBy=default.target`;

  try {
    const systemdDir = dirname(servicePath);
    if (!existsSync(systemdDir)) {
      mkdirSync(systemdDir, { recursive: true });
    }
    writeFileSync(servicePath, serviceContent, 'utf-8');
    console.log(`✅ Generated Systemd service: ${servicePath}`);
    console.log(`   To enable: systemctl --user enable --now claudeclaw-agent-${agentId}`);
  } catch (e) {
    console.error(`❌ Failed to write Systemd service: ${e}`);
  }
}

async function main() {
  console.log('=== 🧙 ClaudeClaw Agent Creation Wizard ===\\n');

  const id = await question('Agent ID (e.g. dev, comms): ');
  if (!id) {
    console.log('Agent ID is required.');
    process.exit(1);
  }

  const name = await question('Agent Name: ') || id;
  const description = await question('Description: ');
  const model = await question('Model (default: claude-sonnet-4-6): ') || 'claude-sonnet-4-6';
  
  let telegramToken = '';
  while (true) {
    telegramToken = await question('Telegram Bot Token (optional): ');
    if (!telegramToken) break;

    console.log('Validating Telegram token...');
    const isValid = await validateTelegramToken(telegramToken);
    if (isValid) {
      console.log('✅ Token is valid!');
      break;
    } else {
      console.log('❌ Invalid token. Please try again or leave empty to skip.');
    }
  }

  const config: AgentConfig = {
    id,
    name,
    description: description || undefined,
    model,
    telegramToken: telegramToken || undefined,
    cwd: join(PROJECT_ROOT, 'agents', id),
    claudeMdPath: join(PROJECT_ROOT, 'agents', id, 'CLAUDE.md'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    saveAgentConfigToDb(config);
    console.log(`\\n✅ Agent '${id}' saved to database!`);

    // Generate service files
    const osType = process.platform;
    const logsDir = join(PROJECT_ROOT, 'logs');
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

    if (osType === 'darwin') {
      generateLaunchdPlist(id);
    } else if (osType === 'linux') {
      generateSystemdService(id);
    } else {
      console.log('OS not supported for automatic service generation (must be macOS or Linux).');
    }

  } catch (err) {
    console.error('Failed to create agent:', err);
  } finally {
    rl.close();
  }
}

main().catch(console.error);

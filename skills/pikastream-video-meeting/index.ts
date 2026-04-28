import { readEnvFile } from '../../src/env.js';
import { logger } from '../../src/logger.js';

export interface PikastreamConfig {
  recallApiKey: string;
  avatarVideoUrl?: string; // e.g. Pika generated looping avatar
}

export interface PreflightBriefing {
  attendees: string[];
  recentEmails: string[];
  meetingContext: string;
}

/**
 * Fetch calendar and recent emails to build a pre-flight briefing.
 * Mock implementation to fulfill the Pikastream requirement.
 */
export async function fetchPreflightBriefing(meetingUrl: string): Promise<PreflightBriefing> {
  logger.info({ meetingUrl }, 'Fetching pre-flight briefing from Google Workspace (Calendar/Gmail)');
  
  // In a real implementation, this would use googleapis with a service account
  // to fetch the calendar event for the meeting URL and recent emails from attendees.
  return {
    attendees: ['client@example.com', 'team@example.com'],
    recentEmails: [
      'Discuss project requirements today.',
      'Can we also go over the Q3 budget?'
    ],
    meetingContext: 'Project kickoff and Q3 budget discussion.'
  };
}

/**
 * Join a meeting (Zoom, Meet, Teams) using Recall.ai API and inject a Pika avatar.
 */
export async function joinMeetingWithAvatar(meetingUrl: string, botName: string): Promise<{ botId: string }> {
  const env = readEnvFile(['RECALL_API_KEY', 'PIKA_AVATAR_URL']);
  const apiKey = env['RECALL_API_KEY'];
  const avatarUrl = env['PIKA_AVATAR_URL'] || 'https://example.com/default-avatar.mp4';

  if (!apiKey) {
    logger.warn('RECALL_API_KEY is not set. Simulating bot join.');
    return { botId: `simulated-bot-${Date.now()}` };
  }

  logger.info({ meetingUrl, botName }, 'Sending bot join request to Recall.ai API');

  try {
    const response = await fetch('https://api.recall.ai/api/v1/bot', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: botName,
        // Config for video avatar injection
        video_url: avatarUrl,
        transcription_options: {
          provider: 'gladia' // or deepgram
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Recall.ai API error: ${response.statusText}`);
    }

    const data = await response.json() as any;
    logger.info({ botId: data.id }, 'Bot successfully scheduled to join meeting');
    
    return { botId: data.id };
  } catch (error) {
    logger.error({ error }, 'Failed to join meeting with avatar');
    throw error;
  }
}

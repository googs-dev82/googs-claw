export interface PikastreamConfig {
    recallApiKey: string;
    avatarVideoUrl?: string;
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
export declare function fetchPreflightBriefing(meetingUrl: string): Promise<PreflightBriefing>;
/**
 * Join a meeting (Zoom, Meet, Teams) using Recall.ai API and inject a Pika avatar.
 */
export declare function joinMeetingWithAvatar(meetingUrl: string, botName: string): Promise<{
    botId: string;
}>;
//# sourceMappingURL=index.d.ts.map
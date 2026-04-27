export type ErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'context_exhausted'
  | 'timeout'
  | 'subprocess_crash'
  | 'network'
  | 'billing'
  | 'overloaded'
  | 'unknown';

export interface ErrorRecovery {
  shouldRetry: boolean;
  shouldNewChat: boolean;
  shouldSwitchModel: boolean;
  retryAfterMs: number;
  userMessage: string;
}

interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  recovery: Omit<ErrorRecovery, 'userMessage'> & { userMessage?: string };
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'auth',
    patterns: [
      /unauthorized/i,
      /401/i,
      /invalid api key/i,
      /authentication failed/i,
      /not authenticated/i,
    ],
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Authentication failed. Please check your API key.',
    },
  },
  {
    category: 'rate_limit',
    patterns: [
      /rate limit/i,
      /429/i,
      /too many requests/i,
      /rate limit exceeded/i,
      /quota exceeded/i,
    ],
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 60000,
      userMessage: 'Rate limit hit. Retrying in a moment...',
    },
  },
  {
    category: 'context_exhausted',
    patterns: [
      /context window/i,
      /max tokens/i,
      /context length/i,
      /token limit/i,
      /input too long/i,
      /context_exhausted/i,
    ],
    recovery: {
      shouldRetry: false,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Context limit reached. Starting a new chat.',
    },
  },
  {
    category: 'timeout',
    patterns: [
      /timeout/i,
      /timed out/i,
      /request timeout/i,
      /took too long/i,
    ],
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 30000,
      userMessage: 'Request timed out. Retrying...',
    },
  },
  {
    category: 'subprocess_crash',
    patterns: [
      /child process.*exited/i,
      /spawn.*failed/i,
      /subprocess.*crashed/i,
      /ENOENT/i,
      /spawn.*not found/i,
    ],
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 5000,
      userMessage: 'Process crashed. Retrying...',
    },
  },
  {
    category: 'network',
    patterns: [
      /network error/i,
      /connection refused/i,
      /connection reset/i,
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /socket timeout/i,
      /dns/i,
    ],
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 10000,
      userMessage: 'Network error. Retrying...',
    },
  },
  {
    category: 'billing',
    patterns: [
      /billing/i,
      /insufficient credits/i,
      /payment required/i,
      /account limited/i,
      /credit limit/i,
    ],
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Billing issue. Please check your account.',
    },
  },
  {
    category: 'overloaded',
    patterns: [
      /overloaded/i,
      /503/i,
      /service unavailable/i,
      /server busy/i,
      /try again later/i,
    ],
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 30000,
      userMessage: 'Service overloaded. Retrying...',
    },
  },
];

const DEFAULT_RECOVERY: ErrorRecovery = {
  shouldRetry: true,
  shouldNewChat: false,
  shouldSwitchModel: false,
  retryAfterMs: 5000,
  userMessage: 'An error occurred. Retrying...',
};

export function classifyError(error: Error | string): {
  category: ErrorCategory;
  recovery: ErrorRecovery;
} {
  const errorStr = error instanceof Error ? error.message : error;
  
  for (const { category, patterns, recovery } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(errorStr)) {
        return {
          category,
          recovery: {
            ...recovery,
            userMessage: recovery.userMessage ?? DEFAULT_RECOVERY.userMessage,
          },
        };
      }
    }
  }
  
  return {
    category: 'unknown',
    recovery: DEFAULT_RECOVERY,
  };
}

export function getRetryDelay(category: ErrorCategory): number {
  const found = ERROR_PATTERNS.find(p => p.category === category);
  return found?.recovery.retryAfterMs ?? DEFAULT_RECOVERY.retryAfterMs;
}

export function shouldRetry(category: ErrorCategory): boolean {
  const found = ERROR_PATTERNS.find(p => p.category === category);
  return found?.recovery.shouldRetry ?? DEFAULT_RECOVERY.shouldRetry;
}

export function shouldNewChat(category: ErrorCategory): boolean {
  const found = ERROR_PATTERNS.find(p => p.category === category);
  return found?.recovery.shouldNewChat ?? DEFAULT_RECOVERY.shouldNewChat;
}
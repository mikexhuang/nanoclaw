import { Channel } from './types.js';
import { logger } from './logger.js';

// Sliding window rate tracker
const messageTimes: number[] = [];
const RATE_WINDOW_MS = 3600000; // 1 hour
const RATE_WARN_THRESHOLD = 20;

/**
 * Send a message with random human-like delay (1-3 seconds).
 * Tracks message rate and logs warning if >20 messages/hour.
 */
export async function pacedSend(
  channel: Channel,
  jid: string,
  text: string,
): Promise<void> {
  const delay = 1000 + Math.random() * 2000; // 1-3s uniform distribution
  await new Promise((r) => setTimeout(r, delay));

  await channel.sendMessage(jid, text);

  // Track rate
  const now = Date.now();
  messageTimes.push(now);

  const warning = getRateWarning();
  if (warning) {
    logger.warn({ jid, rate: warning }, 'Message rate warning');
  }
}

/**
 * Check if message rate exceeds threshold.
 * Returns warning message if over 20/hour, null otherwise.
 */
export function getRateWarning(): string | null {
  const now = Date.now();
  // Prune old entries
  while (messageTimes.length > 0 && messageTimes[0] < now - RATE_WINDOW_MS) {
    messageTimes.shift();
  }
  if (messageTimes.length > RATE_WARN_THRESHOLD) {
    return `${messageTimes.length} messages in the last hour (threshold: ${RATE_WARN_THRESHOLD})`;
  }
  return null;
}

/**
 * Reset rate tracker (for testing).
 */
export function _resetRateTracker(): void {
  messageTimes.length = 0;
}

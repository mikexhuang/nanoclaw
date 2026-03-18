import { Channel } from './types.js';
import { logger } from './logger.js';

export interface HealthStatus {
  whatsappConnected: boolean;
  lastMessageTime: string | null;
  memoryUsageMB: number;
  diskUsagePercent: number | null;
  uptime: number;
}

const HEALTH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const RECONNECT_BACKOFF = [30_000, 120_000, 600_000]; // 30s, 2min, 10min

let previousStatus: 'healthy' | 'down' = 'healthy';
let healthInterval: ReturnType<typeof setInterval> | null = null;

export async function checkHealth(
  channels: Channel[],
): Promise<HealthStatus> {
  const waChannel = channels.find((c) => c.name === 'whatsapp');
  const memUsage = process.memoryUsage();

  let diskUsagePercent: number | null = null;
  try {
    const { execSync } = await import('child_process');
    const output = execSync(
      "df /store 2>/dev/null | tail -1 | awk '{print $5}'",
      { encoding: 'utf-8' },
    );
    const match = output.trim().match(/(\d+)%/);
    if (match) diskUsagePercent = parseInt(match[1], 10);
  } catch {
    // Disk check may fail locally or if /store doesn't exist
  }

  return {
    whatsappConnected: waChannel?.isConnected() ?? false,
    lastMessageTime: null, // TODO: query from SQLite
    memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    diskUsagePercent,
    uptime: process.uptime(),
  };
}

export async function attemptReconnect(
  waChannel: Channel,
): Promise<boolean> {
  for (let i = 0; i < RECONNECT_BACKOFF.length; i++) {
    const delay = RECONNECT_BACKOFF[i];
    logger.info(
      { attempt: i + 1, delayMs: delay },
      'Attempting WhatsApp reconnection',
    );
    await new Promise((r) => setTimeout(r, delay));
    try {
      await waChannel.connect();
      if (waChannel.isConnected()) {
        logger.info('WhatsApp reconnected successfully');
        return true;
      }
    } catch (err) {
      logger.warn(
        { attempt: i + 1, error: err },
        'Reconnection attempt failed',
      );
    }
  }
  logger.error(
    'All reconnection attempts failed. Check Railway logs for QR code.',
  );
  return false;
}

export async function healthProbe(
  channels: Channel[],
  adminJid: string | null,
): Promise<HealthStatus> {
  const health = await checkHealth(channels);
  const currentStatus = health.whatsappConnected ? 'healthy' : 'down';

  // Always log structured health data
  logger.info({ health }, 'Health probe');

  // Alert only on status transitions
  if (currentStatus !== previousStatus) {
    const waChannel = channels.find((c) => c.name === 'whatsapp');

    if (currentStatus === 'down') {
      logger.error({ health }, 'WhatsApp disconnected, attempting reconnect');
      if (waChannel) {
        const reconnected = await attemptReconnect(waChannel);
        if (reconnected && adminJid) {
          previousStatus = 'healthy';
          await waChannel.sendMessage(
            adminJid,
            '*Butler is back online* -- WhatsApp connection restored after auto-reconnect',
          );
          return await checkHealth(channels);
        }
      }
      // If we couldn't reconnect, log error
      logger.error(
        'WhatsApp is down and auto-reconnect failed. Check Railway logs for QR code.',
      );
      previousStatus = 'down';
    } else if (currentStatus === 'healthy' && adminJid) {
      const waChannel2 = channels.find((c) => c.name === 'whatsapp');
      if (waChannel2) {
        await waChannel2.sendMessage(
          adminJid,
          '*Butler is back online* -- WhatsApp connection restored',
        );
      }
      previousStatus = 'healthy';
    }
  }

  return health;
}

export function startHealthMonitor(
  channels: Channel[],
  adminJid: string | null,
): void {
  // Run first probe shortly after startup (10 seconds)
  setTimeout(() => healthProbe(channels, adminJid), 10_000);

  // Then every 30 minutes
  healthInterval = setInterval(
    () => healthProbe(channels, adminJid),
    HEALTH_INTERVAL_MS,
  );

  logger.info(
    { intervalMs: HEALTH_INTERVAL_MS, adminJid },
    'Health monitor started',
  );
}

export function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

/** Reset state for testing */
export function _resetHealthState(): void {
  previousStatus = 'healthy';
  stopHealthMonitor();
}

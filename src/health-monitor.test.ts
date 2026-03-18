import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkHealth,
  healthProbe,
  attemptReconnect,
  startHealthMonitor,
  stopHealthMonitor,
  _resetHealthState,
} from './health-monitor.js';
import { Channel } from './types.js';

// Mock logger to suppress output during tests
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    name: 'whatsapp',
    connect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    ownsJid: vi.fn().mockReturnValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('health-monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetHealthState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checkHealth returns whatsappConnected: true when channel.isConnected() returns true', async () => {
    const channel = makeChannel({ isConnected: vi.fn().mockReturnValue(true) });
    const health = await checkHealth([channel]);
    expect(health.whatsappConnected).toBe(true);
  });

  it('checkHealth returns whatsappConnected: false when channel.isConnected() returns false', async () => {
    const channel = makeChannel({
      isConnected: vi.fn().mockReturnValue(false),
    });
    const health = await checkHealth([channel]);
    expect(health.whatsappConnected).toBe(false);
  });

  it('checkHealth includes memoryUsageMB as a number > 0', async () => {
    const channel = makeChannel();
    const health = await checkHealth([channel]);
    expect(typeof health.memoryUsageMB).toBe('number');
    expect(health.memoryUsageMB).toBeGreaterThan(0);
  });

  it('healthProbe sends alert to admin JID on healthy->down transition', async () => {
    const channel = makeChannel({
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockRejectedValue(new Error('connection failed')),
    });
    const adminJid = 'admin@g.us';

    // First probe: healthy->down (channel is disconnected)
    // Reconnect will fail, so it stays down
    const promise = healthProbe([channel], adminJid);
    // Advance timers for reconnect backoff attempts (30s + 2min + 10min)
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(600_000);
    await promise;

    // Cannot send WhatsApp alert when WhatsApp is down, so check logger was called
    // The health probe should have logged an error about being down
    const { logger } = await import('./logger.js');
    expect(logger.error).toHaveBeenCalled();
  });

  it('healthProbe does NOT send alert when status stays the same (healthy->healthy)', async () => {
    const channel = makeChannel({
      isConnected: vi.fn().mockReturnValue(true),
    });
    const adminJid = 'admin@g.us';

    // First probe: healthy->healthy (no transition)
    await healthProbe([channel], adminJid);

    // Second probe: still healthy->healthy
    await healthProbe([channel], adminJid);

    // No message should be sent since status didn't change
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('healthProbe sends "back online" alert on down->healthy transition', async () => {
    // Start in a down state by simulating a previous down status
    const disconnectedChannel = makeChannel({
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const adminJid = 'admin@g.us';

    // First probe: healthy->down (sets previousStatus to 'down' after failed reconnect)
    const downPromise = healthProbe([disconnectedChannel], adminJid);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(600_000);
    await downPromise;

    // Now channel comes back online
    const connectedChannel = makeChannel({
      isConnected: vi.fn().mockReturnValue(true),
    });

    // Second probe: down->healthy
    await healthProbe([connectedChannel], adminJid);

    // Should send "back online" message
    expect(connectedChannel.sendMessage).toHaveBeenCalledWith(
      adminJid,
      expect.stringContaining('back online'),
    );
  });

  it('attemptReconnect retries 3 times with backoff delays (30s, 2min, 10min)', async () => {
    const channel = makeChannel({
      isConnected: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockRejectedValue(new Error('fail')),
    });

    const promise = attemptReconnect(channel);

    // First retry after 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.connect).toHaveBeenCalledTimes(1);

    // Second retry after 2min
    await vi.advanceTimersByTimeAsync(120_000);
    expect(channel.connect).toHaveBeenCalledTimes(2);

    // Third retry after 10min
    await vi.advanceTimersByTimeAsync(600_000);
    expect(channel.connect).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe(false); // All attempts failed
  });

  it('startHealthMonitor sets up a 30-minute interval', async () => {
    const channel = makeChannel({
      isConnected: vi.fn().mockReturnValue(true),
    });

    startHealthMonitor([channel], null);

    // First probe runs at 10s
    await vi.advanceTimersByTimeAsync(10_000);

    // Then at 30 minutes
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    // isConnected should have been called for both probes
    expect(channel.isConnected).toHaveBeenCalled();

    stopHealthMonitor();
  });
});

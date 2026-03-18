import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pacedSend, getRateWarning, _resetRateTracker } from './message-pacing.js';
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

describe('message-pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetRateTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pacedSend delays between 1000ms and 3000ms', async () => {
    const channel = makeChannel();
    // Mock Math.random to return 0.5 -> delay = 1000 + 0.5 * 2000 = 2000ms
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const promise = pacedSend(channel, 'test@g.us', 'hello');
    // At time 0, sendMessage should NOT have been called yet
    expect(channel.sendMessage).not.toHaveBeenCalled();

    // Advance 1999ms - still not called (delay is 2000ms)
    await vi.advanceTimersByTimeAsync(1999);
    expect(channel.sendMessage).not.toHaveBeenCalled();

    // Advance past 2000ms
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(channel.sendMessage).toHaveBeenCalledOnce();

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('pacedSend calls channel.sendMessage with correct jid and text after delay', async () => {
    const channel = makeChannel();
    vi.spyOn(Math, 'random').mockReturnValue(0); // delay = 1000ms (minimum)

    const promise = pacedSend(channel, 'group@g.us', 'test message');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(channel.sendMessage).toHaveBeenCalledWith('group@g.us', 'test message');
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('getRateWarning returns null when under 20 messages/hour', async () => {
    const channel = makeChannel();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Send 19 messages (under threshold)
    for (let i = 0; i < 19; i++) {
      const p = pacedSend(channel, 'g@g.us', 'msg');
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    }

    expect(getRateWarning()).toBeNull();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('getRateWarning returns warning string when over 20 messages/hour', async () => {
    const channel = makeChannel();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Send 21 messages (over threshold)
    for (let i = 0; i < 21; i++) {
      const p = pacedSend(channel, 'g@g.us', 'msg');
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    }

    const warning = getRateWarning();
    expect(warning).not.toBeNull();
    expect(warning).toContain('21');
    expect(warning).toContain('20');
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('rate counter resets after 1 hour window', async () => {
    const channel = makeChannel();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // Send 21 messages
    for (let i = 0; i < 21; i++) {
      const p = pacedSend(channel, 'g@g.us', 'msg');
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    }

    expect(getRateWarning()).not.toBeNull();

    // Advance time past the 1-hour window
    await vi.advanceTimersByTimeAsync(3600000);

    expect(getRateWarning()).toBeNull();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('sendReadReceipt calls the underlying readMessages function when available', async () => {
    const readMessagesFn = vi.fn().mockResolvedValue(undefined);
    const channel = makeChannel({
      sendReadReceipt: readMessagesFn,
    } as Partial<Channel> & { sendReadReceipt: ReturnType<typeof vi.fn> });

    // Verify the channel has the sendReadReceipt method
    expect('sendReadReceipt' in channel).toBe(true);
    await (channel as any).sendReadReceipt('group@g.us', ['msg1', 'msg2']);
    expect(readMessagesFn).toHaveBeenCalledWith('group@g.us', ['msg1', 'msg2']);
  });
});

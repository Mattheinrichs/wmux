import { describe, it, expect, vi, beforeEach } from 'vitest';
import WebSocket from 'ws';

/**
 * A CDP client attached through the proxy (chrome-devtools-mcp, Playwright) is
 * an agent driving the pane as surely as `wmux browser` is. While the user was
 * on another workspace its commands hung on a pane that had stopped painting;
 * the proxy now renews the pane's lease to keep painting before each command
 * it forwards (browser-keep-rendering.ts).
 */

const fake = vi.hoisted(() => {
  const order: string[] = [];
  const wc = {
    id: 42,
    isDestroyed: () => false,
    getTitle: () => 'page',
    getURL: () => 'https://example.test/',
    debugger: {
      isAttached: () => true,
      sendCommand: async (method: string) => { order.push(`send ${method}`); return { value: 1 }; },
      on: () => {},
      removeListener: () => {},
    },
  };
  return { order, wc };
});

vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => (id === fake.wc.id ? fake.wc : undefined) },
}));

import { CDPProxy } from '../../src/main/cdp-proxy';

async function roundTrip(port: number, message: object): Promise<any> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/1`);
  try {
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const reply = new Promise<any>((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
    ws.send(JSON.stringify(message));
    return await reply;
  } finally {
    ws.close();
  }
}

describe('CDPProxy keeps the pane it drives painting', () => {
  beforeEach(() => { fake.order.length = 0; });

  async function withProxy(fn: (proxy: CDPProxy, port: number) => Promise<void>): Promise<void> {
    const proxy = new CDPProxy();
    await proxy.start();
    const port = proxy.getPort();
    if (port === null) {
      // Same contract as cdp-proxy.test.ts: say so rather than fail on the environment.
      console.warn('[test] skipped: CDP proxy bound no port');
      proxy.stop();
      return;
    }
    proxy.setWebContentsId(fake.wc.id);
    try {
      await fn(proxy, port);
    } finally {
      proxy.stop();
    }
  }

  it('renews the lease before it forwards a command', async () => {
    await withProxy(async (proxy, port) => {
      proxy.onBeforeCommand(async (wcId) => { fake.order.push(`lease ${wcId}`); });
      const reply = await roundTrip(port, { id: 1, method: 'Page.captureScreenshot', params: {} });
      expect(reply).toEqual({ id: 1, result: { value: 1 } });
      expect(fake.order).toEqual(['lease 42', 'send Page.captureScreenshot']);
    });
  });

  it('forwards the command anyway when the lease cannot be granted', async () => {
    await withProxy(async (proxy, port) => {
      proxy.onBeforeCommand(async () => { throw new Error('renderer went away'); });
      const reply = await roundTrip(port, { id: 2, method: 'Runtime.evaluate', params: { expression: '1' } });
      expect(reply).toEqual({ id: 2, result: { value: 1 } });
      expect(fake.order).toEqual(['send Runtime.evaluate']);
    });
  });
});

/**
 * Fetcher hardening: hard total deadline, DNS pinning under rebinding,
 * and accept-encoding: identity.
 */
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import dns from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { config } from '../src/config.js';
import { fetchPage, setFetchTargetResolverForTests } from '../src/lib/fetcher.js';

afterEach(() => {
  setFetchTargetResolverForTests(null);
  config.fetch.timeoutMs = Number(process.env.PAGEPULSE_FETCH_TIMEOUT_MS ?? 15_000);
});

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          })
      });
    });
    server.on('error', reject);
  });
}

describe('hard total fetch deadline', () => {
  it('times out a slow-drip response that keeps the socket busy', async () => {
    const previousTimeout = config.fetch.timeoutMs;
    config.fetch.timeoutMs = 400;

    const { port, close } = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write('<html><body>');
      const drip = setInterval(() => {
        // Keep sending bytes so an idle-only socket timeout would never fire.
        res.write('x');
      }, 50);
      req.on('close', () => clearInterval(drip));
      // Never ends while the client stays connected.
    });

    // Bypass SSRF for the local fixture; we are testing the deadline, not the guard.
    setFetchTargetResolverForTests(async (raw) => ({
      url: new URL(raw),
      addresses: ['127.0.0.1'],
      selfLab: true
    }));

    try {
      const started = Date.now();
      const result = await fetchPage(`http://127.0.0.1:${port}/slow`);
      const elapsed = Date.now() - started;
      expect(result.status).toBe('timeout');
      expect(result.details).toMatch(/did not respond within/i);
      // Must abort near the hard deadline, not hang indefinitely.
      expect(elapsed).toBeGreaterThanOrEqual(300);
      expect(elapsed).toBeLessThan(2500);
    } finally {
      config.fetch.timeoutMs = previousTimeout;
      setFetchTargetResolverForTests(null);
      await close();
    }
  });
});

describe('DNS pinning under rebinding', () => {
  it('connects to the pinned address even when DNS would return a private IP at connect time', async () => {
    let hitPinned = 0;
    let seenAcceptEncoding: string | undefined;
    const { port, close } = await listen((req, res) => {
      hitPinned++;
      seenAcceptEncoding = String(req.headers['accept-encoding'] ?? '');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Pinned</h1><p>ok</p></body></html>');
    });

    const hostname = 'would-rebind.pagepulse.test';
    const privateAtConnect = '169.254.169.254';

    // If the fetcher re-resolved via system DNS at connect time, it would get
    // the private metadata address instead of the pinned loopback target.
    const originalLookup = dns.lookup;
    const lookupMock: typeof dns.lookup = ((host: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number
      ) => void;
      if (host === hostname) {
        const opts = typeof options === 'object' && options !== null ? (options as { all?: boolean }) : {};
        if (opts.all) {
          cb(null, [{ address: privateAtConnect, family: 4 }]);
        } else {
          cb(null, privateAtConnect, 4);
        }
        return;
      }
      return (originalLookup as Function).call(dns, host, options, callback);
    }) as typeof dns.lookup;

    dns.lookup = lookupMock;

    setFetchTargetResolverForTests(async (raw) => {
      const url = new URL(raw);
      expect(url.hostname).toBe(hostname);
      return {
        url,
        addresses: ['127.0.0.1'],
        selfLab: false
      };
    });

    try {
      const result = await fetchPage(`http://${hostname}:${port}/page`);
      expect(result.status).toBe('ok');
      expect(result.html).toContain('Pinned');
      expect(hitPinned).toBe(1);
      expect(seenAcceptEncoding).toMatch(/identity/i);
    } finally {
      dns.lookup = originalLookup;
      setFetchTargetResolverForTests(null);
      await close();
    }
  });

  it('refuses to connect when the pin list is empty instead of falling back to system DNS', async () => {
    // Literal IPs skip custom lookup in Node, so use a hostname URL.
    let connected = false;
    const { port, close } = await listen((_req, res) => {
      connected = true;
      res.end('nope');
    });

    const hostname = 'empty-pin.pagepulse.test';
    const originalLookup = dns.lookup;
    dns.lookup = ((host: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number
      ) => void;
      if (host === hostname) {
        cb(null, '169.254.169.254', 4);
        return;
      }
      return (originalLookup as Function).call(dns, host, options, callback);
    }) as typeof dns.lookup;

    setFetchTargetResolverForTests(async (raw) => ({
      url: new URL(raw),
      // Empty pin list: lookup must refuse rather than fall back to system DNS.
      addresses: [],
      selfLab: false
    }));

    try {
      const result = await fetchPage(`http://${hostname}:${port}/`);
      expect(result.status).toBe('network_error');
      expect(connected).toBe(false);
    } finally {
      dns.lookup = originalLookup;
      setFetchTargetResolverForTests(null);
      await close();
    }
  });
});

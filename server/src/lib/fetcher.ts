/**
 * Secure server-side webpage fetcher.
 *
 * - Validates the initial URL and every redirect hop through urlGuard.
 * - Pins each connection to the DNS addresses validated for that hop
 *   (custom lookup) so DNS cannot rebind to a private IP after the check.
 * - Follows at most `maxRedirects` redirects manually.
 * - Enforces a timeout and a maximum response size (streamed).
 * - Accepts only HTML/XHTML/plain-text responses.
 * - Sends an honest PagePulse user agent and never sends cookies.
 */
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { config } from '../config.js';
import { resolveSafeFetchTarget, UrlGuardError } from './urlGuard.js';
import type { FetchStatus } from '../types.js';

export interface FetchResult {
  status: FetchStatus;
  httpStatus: number | null;
  finalUrl: string;
  html: string;
  contentType: string;
  details: string;
}

const ACCEPTED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

interface PinnedResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function pinnedLookup(addresses: string[]): LookupFunction {
  return (hostname, options, callback) => {
    const all = Boolean(options && typeof options === 'object' && 'all' in options && options.all);
    if (addresses.length === 0) {
      callback(
        Object.assign(new Error(`Refusing to connect: no validated address for ${hostname}`), { code: 'ENOTFOUND' }),
        '',
        0
      );
      return;
    }
    if (all) {
      callback(
        null,
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
      );
      return;
    }
    const address = addresses[0]!;
    callback(null, address, address.includes(':') ? 6 : 4);
  };
}

function requestPinned(url: URL, addresses: string[], timeoutMs: number, maxBytes: number): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const headers: http.OutgoingHttpHeaders = {
      host: url.host,
      'user-agent': config.fetch.userAgent,
      accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8',
      'accept-language': 'en',
      connection: 'close'
    };

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        timeout: timeoutMs,
        servername: url.hostname.replace(/^\[|\]$/g, ''),
        lookup: pinnedLookup(addresses),
        // Do not follow redirects — we validate each hop ourselves.
        // Agent defaults are fine; we close after each response.
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          reject(err);
        };

        res.on('data', (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > maxBytes) {
            fail(Object.assign(new Error(`Response larger than ${maxBytes} bytes`), { code: 'MAX_BYTES' }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
        res.on('error', fail);
      }
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function fetchPage(rawUrl: string): Promise<FetchResult> {
  let currentUrl = rawUrl;
  const failure = (status: FetchStatus, details: string, httpStatus: number | null = null): FetchResult => ({
    status,
    httpStatus,
    finalUrl: currentUrl,
    html: '',
    contentType: '',
    details
  });

  for (let hop = 0; hop <= config.fetch.maxRedirects; hop++) {
    let target: Awaited<ReturnType<typeof resolveSafeFetchTarget>>;
    try {
      target = await resolveSafeFetchTarget(currentUrl);
    } catch (err) {
      if (err instanceof UrlGuardError) return failure('blocked', err.message);
      return failure('blocked', 'The URL failed safety validation.');
    }

    let res: PinnedResponse;
    try {
      res = await requestPinned(target.url, target.addresses, config.fetch.timeoutMs, config.fetch.maxBytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as { name?: string; code?: string }).name === 'TimeoutError' || /timed? ?out/i.test(msg)) {
        return failure('timeout', `The page did not respond within ${config.fetch.timeoutMs / 1000} seconds.`);
      }
      if ((err as { code?: string }).code === 'MAX_BYTES') {
        return failure(
          'unsupported',
          `The page is larger than ${(config.fetch.maxBytes / 1024 / 1024).toFixed(0)} MB, which PagePulse does not process.`
        );
      }
      return failure('network_error', `Could not reach the page: ${msg}`);
    }

    // Redirects: validate the destination and continue.
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      if (!location || Array.isArray(location)) {
        return failure('http_error', `The server sent a redirect (${res.statusCode}) without a destination.`, res.statusCode);
      }
      if (hop === config.fetch.maxRedirects) {
        return failure('http_error', `Too many redirects (more than ${config.fetch.maxRedirects}).`, res.statusCode);
      }
      currentUrl = new URL(location, target.url).toString();
      continue;
    }

    if (res.statusCode === 401 || res.statusCode === 403) {
      return failure(
        'blocked',
        `The page returned HTTP ${res.statusCode}. It likely requires a login or uses anti-bot protection, so PagePulse cannot monitor it reliably.`,
        res.statusCode
      );
    }
    if (res.statusCode === 429) {
      return failure('blocked', 'The site is rate-limiting requests (HTTP 429). Try again later or use a lower check frequency.', res.statusCode);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return failure('http_error', `The page returned HTTP ${res.statusCode}.`, res.statusCode);
    }

    const rawType = res.headers['content-type'];
    const contentType = (Array.isArray(rawType) ? rawType[0] : rawType ?? '').toLowerCase();
    if (!ACCEPTED_TYPES.some((t) => contentType.includes(t))) {
      return failure(
        'unsupported',
        `Unsupported content type "${contentType || 'unknown'}". PagePulse monitors readable HTML pages (not PDFs, images, or files).`,
        res.statusCode
      );
    }

    const html = res.body.toString('utf8');
    const received = res.body.byteLength;
    return {
      status: 'ok',
      httpStatus: res.statusCode,
      finalUrl: target.url.toString(),
      html,
      contentType,
      details: `Fetched ${received.toLocaleString()} bytes (HTTP ${res.statusCode}).`
    };
  }
  return failure('http_error', 'Too many redirects.');
}

/**
 * Secure server-side webpage fetcher.
 *
 * - Validates the initial URL and every redirect hop through urlGuard.
 * - Follows at most `maxRedirects` redirects manually.
 * - Enforces a timeout and a maximum response size (streamed).
 * - Accepts only HTML/XHTML/plain-text responses.
 * - Sends an honest PagePulse user agent and never sends cookies.
 */
import { config } from '../config.js';
import { assertSafeUrl, UrlGuardError } from './urlGuard.js';
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
    let url: URL;
    try {
      url = await assertSafeUrl(currentUrl);
    } catch (err) {
      if (err instanceof UrlGuardError) return failure('blocked', err.message);
      return failure('blocked', 'The URL failed safety validation.');
    }

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(config.fetch.timeoutMs),
        headers: {
          'user-agent': config.fetch.userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8',
          'accept-language': 'en'
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timeout') || (err as { name?: string }).name === 'TimeoutError') {
        return failure('timeout', `The page did not respond within ${config.fetch.timeoutMs / 1000} seconds.`);
      }
      return failure('network_error', `Could not reach the page: ${msg}`);
    }

    // Redirects: validate the destination and continue.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!location) return failure('http_error', `The server sent a redirect (${res.status}) without a destination.`, res.status);
      if (hop === config.fetch.maxRedirects) {
        return failure('http_error', `Too many redirects (more than ${config.fetch.maxRedirects}).`, res.status);
      }
      currentUrl = new URL(location, url).toString();
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      res.body?.cancel().catch(() => {});
      return failure(
        'blocked',
        `The page returned HTTP ${res.status}. It likely requires a login or uses anti-bot protection, so PagePulse cannot monitor it reliably.`,
        res.status
      );
    }
    if (res.status === 429) {
      res.body?.cancel().catch(() => {});
      return failure('blocked', 'The site is rate-limiting requests (HTTP 429). Try again later or use a lower check frequency.', res.status);
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return failure('http_error', `The page returned HTTP ${res.status}.`, res.status);
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ACCEPTED_TYPES.some((t) => contentType.includes(t))) {
      res.body?.cancel().catch(() => {});
      return failure(
        'unsupported',
        `Unsupported content type "${contentType || 'unknown'}". PagePulse monitors readable HTML pages (not PDFs, images, or files).`,
        res.status
      );
    }

    // Stream the body with a hard size cap. fetch() decompresses for us.
    const reader = res.body?.getReader();
    if (!reader) return failure('network_error', 'The response had no readable body.');
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > config.fetch.maxBytes) {
          await reader.cancel();
          return failure('unsupported', `The page is larger than ${(config.fetch.maxBytes / 1024 / 1024).toFixed(0)} MB, which PagePulse does not process.`, res.status);
        }
        chunks.push(value);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as { name?: string }).name === 'TimeoutError') {
        return failure('timeout', `The page did not finish loading within ${config.fetch.timeoutMs / 1000} seconds.`);
      }
      return failure('network_error', `The connection dropped while reading the page: ${msg}`);
    }
    const html = Buffer.concat(chunks).toString('utf8');
    return {
      status: 'ok',
      httpStatus: res.status,
      finalUrl: res.url || url.toString(),
      html,
      contentType,
      details: `Fetched ${received.toLocaleString()} bytes (HTTP ${res.status}).`
    };
  }
  return failure('http_error', 'Too many redirects.');
}

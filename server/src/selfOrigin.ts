/**
 * The server's own origin (e.g. http://127.0.0.1:3000), set once the HTTP
 * server is listening. Used to build Evaluation Lab page URLs that the
 * fetcher is allowed to reach (the single sanctioned loopback exception).
 */
import { allowSelfOrigin } from './lib/urlGuard.js';

let origin = '';

export function setSelfOrigin(o: string): void {
  origin = o.replace(/\/$/, '');
  allowSelfOrigin(origin);
}

export function getSelfOrigin(): string {
  return origin;
}

export function labPageUrl(slug: string): string {
  return `${origin}/lab-pages/${slug}`;
}

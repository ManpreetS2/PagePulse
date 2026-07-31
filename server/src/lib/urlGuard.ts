/**
 * SSRF protection for the webpage fetcher.
 *
 * Every URL — including every redirect hop — is validated here before a
 * request is made: only http/https, no localhost, no private or link-local
 * ranges, no internal hostnames, and the DNS resolution of the hostname is
 * checked against the same IP rules.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export class UrlGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_url'
      | 'unsupported_protocol'
      | 'blocked_host'
      | 'blocked_ip'
      | 'dns_failure'
  ) {
    super(message);
    this.name = 'UrlGuardError';
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'metadata.google.internal']);

/**
 * Origins that are explicitly allowed to bypass the private-network block.
 * This is used ONLY for PagePulse's own Evaluation Lab pages, which the
 * server itself hosts on loopback. Nothing else is ever added here.
 */
const selfOriginAllowlist = new Set<string>();

export function allowSelfOrigin(origin: string): void {
  selfOriginAllowlist.add(origin.toLowerCase());
}

export function isSelfLabUrl(url: URL): boolean {
  return selfOriginAllowlist.has(url.origin.toLowerCase()) && url.pathname.startsWith('/lab-pages/');
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // "this", private, loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified, loopback
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7)); // v4-mapped
    return false;
  }
  return true; // unparseable — treat as unsafe
}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlGuardError('That is not a valid URL. Include the full address, e.g. https://example.com/page', 'invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlGuardError(`Only http and https URLs are supported (got "${url.protocol}//").`, 'unsupported_protocol');
  }
  if (url.username || url.password) {
    throw new UrlGuardError('URLs with embedded credentials are not supported.', 'invalid_url');
  }
  return url;
}

/**
 * Validate a URL for outbound fetching. Resolves DNS and checks every
 * returned address. Returns the parsed URL when safe.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  const url = parsePublicUrl(raw);

  // The server's own Evaluation Lab pages are the single sanctioned exception.
  if (isSelfLabUrl(url)) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith('.localhost') || hostname.toLowerCase().endsWith('.local') || hostname.toLowerCase().endsWith('.internal')) {
    throw new UrlGuardError('Local and internal hostnames cannot be monitored.', 'blocked_host');
  }

  // Literal IP addresses.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new UrlGuardError('Private and internal network addresses cannot be monitored.', 'blocked_ip');
    }
    return url;
  }

  // Resolve DNS and validate every address the name points to.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlGuardError(`Could not resolve the hostname "${hostname}". Check the address and try again.`, 'dns_failure');
  }
  if (addresses.length === 0) {
    throw new UrlGuardError(`The hostname "${hostname}" did not resolve to any address.`, 'dns_failure');
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new UrlGuardError('That hostname resolves to a private network address, which cannot be monitored.', 'blocked_ip');
    }
  }
  return url;
}

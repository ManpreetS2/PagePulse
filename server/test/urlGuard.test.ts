import { describe, expect, it } from 'vitest';
import {
  assertSafeUrl,
  extractMappedIpv4,
  isPrivateIp,
  parsePublicUrl,
  resolveSafeFetchTarget,
  UrlGuardError,
  allowSelfOrigin
} from '../src/lib/urlGuard.js';

describe('parsePublicUrl', () => {
  it('accepts normal http(s) URLs', () => {
    expect(parsePublicUrl('https://example.com/page').hostname).toBe('example.com');
    expect(parsePublicUrl('http://example.com').protocol).toBe('http:');
  });

  it('rejects malformed URLs', () => {
    expect(() => parsePublicUrl('not a url')).toThrow(UrlGuardError);
    expect(() => parsePublicUrl('example.com/page')).toThrow(UrlGuardError);
  });

  it('rejects unsupported protocols', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://x']) {
      expect(() => parsePublicUrl(url)).toThrow(UrlGuardError);
    }
  });

  it('rejects embedded credentials', () => {
    expect(() => parsePublicUrl('https://user:pass@example.com')).toThrow(UrlGuardError);
  });
});

describe('isPrivateIp', () => {
  it('flags loopback, private, link-local, CGNAT, and multicast ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.9.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1'
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:0808:0808']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('decodes IPv4-mapped IPv6 hex form', () => {
    expect(extractMappedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(extractMappedIpv4('::ffff:c0a8:0001')).toBe('192.168.0.1');
  });
});

describe('assertSafeUrl', () => {
  it('blocks localhost and internal hostnames', async () => {
    for (const url of ['http://localhost/x', 'http://localhost:3000/', 'https://foo.localhost/', 'https://server.internal/', 'http://printer.local/']) {
      await expect(assertSafeUrl(url), url).rejects.toThrow(UrlGuardError);
    }
  });

  it('blocks literal private IPs including IPv6 forms', async () => {
    for (const url of ['http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.0.10/admin', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[fd00::2]/']) {
      await expect(assertSafeUrl(url), url).rejects.toThrow(UrlGuardError);
    }
  });

  it('blocks hostnames that resolve to private addresses (DNS check)', async () => {
    // localtest.me-style domains resolve to 127.0.0.1; if DNS is offline the
    // lookup failure is also a rejection, so this never touches real content.
    await expect(assertSafeUrl('http://localtest.me/')).rejects.toThrow(UrlGuardError);
  });

  it('allows only the registered self origin for lab pages', async () => {
    allowSelfOrigin('http://127.0.0.1:4999');
    const ok = await assertSafeUrl('http://127.0.0.1:4999/lab-pages/college-admissions');
    expect(ok.pathname).toBe('/lab-pages/college-admissions');
    // Same origin but outside /lab-pages/ stays blocked.
    await expect(assertSafeUrl('http://127.0.0.1:4999/api/secrets')).rejects.toThrow(UrlGuardError);
    // Different loopback port stays blocked.
    await expect(assertSafeUrl('http://127.0.0.1:5000/lab-pages/college-admissions')).rejects.toThrow(UrlGuardError);
  });

  it('returns pinable addresses for self-lab targets', async () => {
    allowSelfOrigin('http://127.0.0.1:4999');
    const target = await resolveSafeFetchTarget('http://127.0.0.1:4999/lab-pages/college-admissions');
    expect(target.selfLab).toBe(true);
    expect(target.addresses).toEqual(['127.0.0.1']);
  });
});

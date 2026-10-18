import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  dataDir: path.resolve(env.DATA_DIR ?? path.join(process.cwd(), '..', 'data')),
  /** Set by tests to use an in-memory database. */
  dbFile: env.PAGEPULSE_DB ?? '',
  fetch: {
    /** Total per-hop deadline (connect + headers + body). Override with PAGEPULSE_FETCH_TIMEOUT_MS. */
    timeoutMs: Number(env.PAGEPULSE_FETCH_TIMEOUT_MS ?? 15_000),
    maxRedirects: 5,
    maxBytes: 3 * 1024 * 1024,
    userAgent: 'PagePulseBot/1.0 (+https://github.com/ManpreetS2/pagepulse; change monitoring)'
  },
  scheduler: {
    enabled: env.NODE_ENV !== 'test' && env.PAGEPULSE_DISABLE_SCHEDULER !== '1',
    /** Minimum milliseconds between fetches to the same host. */
    perDomainIntervalMs: 10_000,
    maxConsecutiveFailuresBeforePause: 5,
    retriesPerCheck: 2
  },
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? 'PagePulse <no-reply@localhost>',
    to: env.NOTIFY_EMAIL_TO ?? ''
  }
};

export const emailConfigured = () => Boolean(config.smtp.host && config.smtp.to);

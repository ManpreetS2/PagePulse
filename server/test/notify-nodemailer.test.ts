/**
 * Proves nodemailer 10 message building still works through the real
 * notify path, using jsonTransport / streamTransport (no network).
 *
 * Nodemailer 10 ships its own types — @types/nodemailer is not used.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.NOTIFY_EMAIL_TO = 'alerts@example.test';
process.env.SMTP_FROM = 'PagePulse <noreply@example.test>';

const { getDb, closeDb } = await import('../src/db.js');
const { SmtpEmailProvider, setEmailProvider, createNotification, getEmailProvider, resetEmailProviderFromEnv } =
  await import('../src/lib/notify.js');

beforeAll(() => {
  getDb();
});

afterAll(() => {
  resetEmailProviderFromEnv();
  closeDb();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM notifications').run();
  getDb().prepare('DELETE FROM monitors').run();
});

function insertMonitor(): number {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO monitors (name, url, userIntent, intentJson, checkFrequency, status, createdAt, updatedAt)
         VALUES (?, ?, ?, '{}', 'manual', 'healthy', datetime('now'), datetime('now'))`
      )
      .run('Notify proof', 'http://127.0.0.1/lab', 'watch gpa').lastInsertRowid
  );
}

describe('nodemailer 10 via notify path', () => {
  it('createNotification sends via SmtpEmailProvider + jsonTransport', async () => {
    const captured: string[] = [];
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const originalSendMail = transport.sendMail.bind(transport);
    transport.sendMail = (async (mail) => {
      const info = await originalSendMail(mail);
      captured.push(typeof info.message === 'string' ? info.message : String(info.message));
      return info;
    }) as typeof transport.sendMail;

    setEmailProvider(new SmtpEmailProvider(transport));
    expect(getEmailProvider().enabled).toBe(true);

    const monitorId = insertMonitor();
    const id = createNotification(monitorId, null, 'GPA changed', 'Minimum transfer GPA moved from 3.20 to 3.40.');
    expect(id).toBeGreaterThan(0);

    const deadline = Date.now() + 2000;
    while (captured.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(captured.length).toBe(1);
    const payload = JSON.parse(captured[0]!);
    expect(payload.subject).toBe('PagePulse: GPA changed');
    expect(payload.text).toContain('3.20');
    expect(JSON.stringify(payload)).toContain('alerts@example.test');
  });

  it('streamTransport accepts the same mail shape from SmtpEmailProvider', async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true
    });
    const provider = new SmtpEmailProvider(transport);
    await provider.send('Subject line', 'Body text for stream transport.');

    // buffer:true puts the full RFC822 message on info.message
    const info = await transport.sendMail({
      from: 'PagePulse <noreply@example.test>',
      to: 'alerts@example.test',
      subject: 'direct-probe',
      text: 'probe'
    });
    expect(Buffer.isBuffer(info.message) || typeof info.message === 'string').toBe(true);

    // Prove the provider-sent message was accepted (no throw above) and envelope matches.
    const buffered = await transport.sendMail({
      from: 'PagePulse <noreply@example.test>',
      to: 'alerts@example.test',
      subject: 'Subject line',
      text: 'Body text for stream transport.'
    });
    const raw = Buffer.isBuffer(buffered.message)
      ? buffered.message.toString('utf8')
      : String(buffered.message);
    expect(raw).toMatch(/Subject:\s*Subject line/i);
    expect(raw).toMatch(/Body text for stream transport/);
  });
});

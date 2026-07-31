/**
 * Notification service: in-app notifications always; email via an
 * optional provider interface. When SMTP is not configured the email
 * provider is a no-op and the app works fully with in-app alerts.
 */
import nodemailer from 'nodemailer';
import { config, emailConfigured } from '../config.js';
import { getDb } from '../db.js';

export interface EmailProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(subject: string, body: string): Promise<void>;
}

class DisabledEmailProvider implements EmailProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  async send(): Promise<void> {
    /* Email delivery is disabled; in-app notifications still work. */
  }
}

class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly enabled = true;
  private transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
  });

  async send(subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: config.smtp.from,
      to: config.smtp.to,
      subject,
      text: body
    });
  }
}

const emailProvider: EmailProvider = emailConfigured() ? new SmtpEmailProvider() : new DisabledEmailProvider();

export function getEmailProvider(): EmailProvider {
  return emailProvider;
}

export function createNotification(monitorId: number, changeId: number | null, title: string, message: string): number {
  const result = getDb()
    .prepare('INSERT INTO notifications (monitorId, changeId, title, message) VALUES (?, ?, ?, ?)')
    .run(monitorId, changeId, title, message);
  // Fire-and-forget email; failures never break the check pipeline.
  if (emailProvider.enabled) {
    emailProvider.send(`PagePulse: ${title}`, message).catch((err) => {
      console.error('[notify] email delivery failed:', err instanceof Error ? err.message : err);
    });
  }
  return Number(result.lastInsertRowid);
}

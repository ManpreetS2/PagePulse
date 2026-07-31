/**
 * Express application factory (shared by the server entrypoint and the
 * integration tests).
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import monitorsRouter from './routes/monitors.js';
import notificationsRouter from './routes/notifications.js';
import labRouter from './routes/lab.js';
import settingsRouter from './routes/settings.js';
import { renderLabPage, LAB_PAGES } from './lab/pages.js';
import { HttpError } from './routes/helpers.js';

/** Minimal fixed-window rate limiter (per IP) — no external service needed. */
function rateLimiter(maxPerMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(key, { count: 1, windowStart: now });
      if (hits.size > 10_000) hits.clear();
      return next();
    }
    entry.count++;
    if (entry.count > maxPerMinute) {
      res.status(429).json({ error: { message: 'Too many requests. Slow down and try again shortly.' } });
      return;
    }
    next();
  };
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '200kb' }));

  /* ---- Evaluation Lab pages (plain HTML, fetched by the monitor pipeline) ---- */
  app.get('/lab-pages', (_req, res) => {
    const links = LAB_PAGES.map((p) => `<li><a href="/lab-pages/${p.slug}">${p.name}</a></li>`).join('');
    res
      .type('html')
      .send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>PagePulse Evaluation Lab Pages</title></head><body><h1>Evaluation Lab pages</h1><ul>${links}</ul></body></html>`);
  });
  app.get('/lab-pages/:slug', (req, res) => {
    const html = renderLabPage(req.params.slug!);
    if (!html) {
      res.status(404).type('html').send('<h1>Unknown lab page</h1>');
      return;
    }
    res.type('html').send(html);
  });

  /* ---- API ---- */
  app.use('/api', rateLimiter(240));
  app.use('/api', monitorsRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', labRouter);
  app.use('/api', settingsRouter);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Unknown API endpoint.' } });
  });

  /* ---- Built client (production) ---- */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(here, '..', '..', 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|lab-pages).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  /* ---- Structured error responses ---- */
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          message: 'Invalid request: ' + err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
          issues: err.issues
        }
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { message: err.message, ...err.extra } });
      return;
    }
    console.error('[api] unexpected error:', err);
    res.status(500).json({ error: { message: 'Something went wrong on the server. Check the server logs for details.' } });
  });

  return app;
}

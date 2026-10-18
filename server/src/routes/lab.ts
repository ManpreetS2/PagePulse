import { Router } from 'express';
import { z } from 'zod';
import { LAB_PAGES, getActiveMutations, getLabPage, setActiveMutations } from '../lab/pages.js';
import { EVAL_SCENARIOS } from '../lab/scenarios.js';
import { isSuiteRunning, latestSuiteReport, runSuite } from '../lab/evalRunner.js';
import { labPageUrl } from '../selfOrigin.js';
import { asyncHandler, HttpError } from './helpers.js';

const router = Router();

router.get('/lab/pages', (_req, res) => {
  res.json(
    LAB_PAGES.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      suggestedIntent: p.suggestedIntent,
      url: labPageUrl(p.slug),
      mutations: p.mutations,
      activeMutations: [...getActiveMutations(p.slug)]
    }))
  );
});

router.post('/lab/pages/:slug/mutations', (req, res) => {
  const slug = req.params.slug!;
  if (!getLabPage(slug)) throw new HttpError(404, 'Unknown lab page.');
  const body = z.object({ mutations: z.array(z.string().max(60)).max(30) }).parse(req.body);
  setActiveMutations(slug, body.mutations);
  res.json({ slug, activeMutations: [...getActiveMutations(slug)] });
});

router.post('/lab/pages/:slug/reset', (req, res) => {
  const slug = req.params.slug!;
  if (!getLabPage(slug)) throw new HttpError(404, 'Unknown lab page.');
  setActiveMutations(slug, []);
  res.json({ slug, activeMutations: [] });
});

router.get('/evaluation/scenarios', (_req, res) => {
  res.json(
    EVAL_SCENARIOS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      pageSlug: s.pageSlug,
      intent: s.intent,
      mutations: s.mutations,
      kind: s.kind,
      expected: s.expected
    }))
  );
});

router.post(
  '/evaluation/run',
  asyncHandler(async (req, res) => {
    if (isSuiteRunning()) throw new HttpError(409, 'An evaluation suite is already running. Wait for it to finish.');
    const body = z
      .object({ scenarioIds: z.array(z.string().trim().min(1).max(80)).max(50).optional() })
      .parse(req.body ?? {});
    const report = await runSuite(body.scenarioIds);
    res.json(report);
  })
);

router.get('/evaluation/latest', (_req, res) => {
  res.json(latestSuiteReport());
});

export default router;

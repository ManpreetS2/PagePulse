import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import {
  continueGuidedDemo,
  getDemoStatus,
  resetGuidedDemo,
  startGuidedDemo
} from '../lib/guidedDemo.js';
import { monitorWithExtras } from '../lib/monitorView.js';

const router = Router();

function enrichMonitor(monitor: ReturnType<typeof getDemoStatus>['monitor']) {
  if (!monitor) return null;
  return monitorWithExtras(monitor);
}

router.get(
  '/demo',
  asyncHandler(async (_req, res) => {
    const result = getDemoStatus();
    res.json({ ...result, monitor: enrichMonitor(result.monitor) });
  })
);

router.post(
  '/demo/start',
  asyncHandler(async (_req, res) => {
    const result = await startGuidedDemo();
    res.status(201).json({ ...result, monitor: enrichMonitor(result.monitor) });
  })
);

router.post(
  '/demo/continue',
  asyncHandler(async (_req, res) => {
    const result = await continueGuidedDemo();
    res.json({ ...result, monitor: enrichMonitor(result.monitor) });
  })
);

router.post(
  '/demo/reset',
  asyncHandler(async (_req, res) => {
    const result = resetGuidedDemo();
    res.json({ ...result, monitor: enrichMonitor(result.monitor) });
  })
);

export default router;

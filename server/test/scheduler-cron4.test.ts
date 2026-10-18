/**
 * Proves node-cron v4 lifecycle used by PagePulse: scheduled tick fires,
 * stop/destroy halts further runs, and cron.shutdown completes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import cron, { type ScheduledTask } from 'node-cron';

describe('node-cron v4 scheduler lifecycle', () => {
  let task: ScheduledTask | null = null;

  afterEach(async () => {
    if (task) {
      try {
        await task.stop();
      } catch {
        /* already stopped */
      }
      try {
        await task.destroy();
      } catch {
        /* already destroyed */
      }
      task = null;
    }
    await cron.shutdown();
  });

  it('createTask stays stopped until start, then the tick fires', async () => {
    let ticks = 0;
    task = cron.createTask('* * * * * *', () => {
      ticks += 1;
    }, { name: 'cron4-tick-proof', noOverlap: true });

    // v4 createTask does not auto-start (unlike schedule()); status is "stopped".
    expect(task.getStatus()).toBe('stopped');
    expect(ticks).toBe(0);

    await task.start();
    expect(['idle', 'running']).toContain(task.getStatus());
    // Wait up to ~2.5s for at least one second-granularity tick.
    const deadline = Date.now() + 2500;
    while (ticks < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ticks).toBeGreaterThanOrEqual(1);
  });

  it('stop prevents further scheduled executions', async () => {
    let ticks = 0;
    task = cron.createTask('* * * * * *', () => {
      ticks += 1;
    }, { name: 'cron4-stop-proof', noOverlap: true });
    await task.start();

    const deadline = Date.now() + 2500;
    while (ticks < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ticks).toBeGreaterThanOrEqual(1);

    await task.stop();
    expect(task.getStatus()).toBe('stopped');
    const afterStop = ticks;
    await new Promise((r) => setTimeout(r, 1200));
    expect(ticks).toBe(afterStop);
  });

  it('PagePulse startScheduler/stopScheduler wire createTask + shutdown', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.PAGEPULSE_DISABLE_SCHEDULER = '';
    process.env.PAGEPULSE_DB = ':memory:';

    const { startScheduler, stopScheduler, getSchedulerTask } = await import('../src/scheduler.js');
    startScheduler();
    const live = getSchedulerTask();
    expect(live).not.toBeNull();
    expect(live!.getPattern()).toBe('* * * * *');
    expect(['idle', 'running']).toContain(live!.getStatus());

    await stopScheduler();
    expect(getSchedulerTask()).toBeNull();
  });
});

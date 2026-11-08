/**
 * Daily Brief host half: one service that owns config, collection and delivery,
 * one loopback HTTP surface for the panel, and one agent tool.
 */
import { createDailyBriefService } from './lib/host/service.js';
import { registerRoutes } from './lib/host/routes.js';
import { registerTools } from './lib/host/tools.js';

export const name = '@local/dsh-daily-brief';
export const inject = ['webServer', 'tools'];

export function apply(ctx, config = {}) {
  const service = createDailyBriefService(ctx, config || {});
  const disposers = [];

  try {
    disposers.push(registerRoutes(ctx, service));
  } catch (error) {
    ctx.logger?.warn?.(`[daily-brief] routes unavailable: ${error?.message || error}`);
  }

  try {
    registerTools(ctx, service);
  } catch (error) {
    ctx.logger?.warn?.(`[daily-brief] tool unavailable: ${error?.message || error}`);
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
  }, 'daily-brief: dispose');

  ctx.logger?.info?.('[daily-brief] ready');
  return service;
}

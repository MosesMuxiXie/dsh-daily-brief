/** Agent tool: one entry point for inspecting and running the daily brief. */

const ACTIONS = ['status', 'list', 'get', 'run', 'popup', 'import', 'sources', 'remove_source', 'test_source'];

export function registerTools(ctx, service) {
  const definition = {
    name: 'daily_brief',
    description:
      '查看或运行 DSH 每日简报。status 查看今日状态与计划任务；list 列出历史简报；get 读取某一天的简报数据；run 立即生成（dryRun 只预览不投递）；popup 在桌面弹出简报窗口；import 按网址/邮箱导入来源（任意网页、YouTube、哔哩哔哩、RSS、日历 ICS、Gmail/QQ 邮箱；Outlook 地址会返回转发指南，不再需要 Azure）；sources 列出已配置来源；remove_source 删除来源；test_source 测试来源。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ACTIONS, description: '要执行的操作' },
        id: { type: 'string', description: '来源 id、简报日期（YYYY-MM-DD）或 latest' },
        text: { type: 'string', description: 'import 时粘贴的网址、邮箱或 OPML；任意网页会提取正文或列表，YouTube / 哔哩哔哩链接会直接识别；Outlook / Hotmail / Live 地址会返回转发到 Gmail / QQ 的指南，不再需要 Azure 客户端 ID' },
        section: { type: 'string', description: 'import 时指定板块 id，可省略' },
        dryRun: { type: 'boolean', description: 'run 时只预览，不写文件、不通知' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2).slice(0, 12000) }];
      },
    },
    async execute(args = {}) {
      const action = args.action;
      if (action === 'status') {
        const state = await service.getState();
        return {
          ok: true,
          schedule: state.schedule,
          lastRun: state.state,
          sources: state.sources.length,
          briefings: state.briefings.length,
          latest: state.latest?.data
            ? {
                id: state.latest.data.dateKey,
                headline: state.latest.data.headline,
                items: state.latest.data.stats?.items ?? 0,
              }
            : null,
          secretsSupported: state.secrets.supported,
          paths: state.paths,
        };
      }
      if (action === 'list') return { ok: true, briefings: (await service.getState()).briefings };
      if (action === 'get') {
        const briefing = await service.getBriefing(args.id || 'latest');
        if (!briefing.ok) return briefing;
        return { ok: true, id: briefing.id, data: briefing.data, file: briefing.file };
      }
      if (action === 'run') return service.run({ dryRun: Boolean(args.dryRun), force: true });
      if (action === 'popup') return service.openPopup(args.id || 'latest');
      if (action === 'import') return service.importText(args.text, args.section);
      if (action === 'sources') {
        const state = await service.getState();
        return { ok: true, sources: state.sources, secrets: state.secrets };
      }
      if (action === 'remove_source') return service.removeSource(args.id);
      if (action === 'test_source') return service.testSource(args.id);
      return { ok: false, error: `未知操作：${action}` };
    },
  };

  let dispose;
  try {
    dispose = ctx.tools.register(definition);
  } catch (error) {
    console.warn(`[daily-brief] 工具注册失败：${error?.message || error}`);
    return () => {};
  }
  return () => {
    try {
      dispose?.();
    } catch {
      // ignore
    }
  };
}

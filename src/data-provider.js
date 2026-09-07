(function () {
  const demoSnapshot = () => ({
    source: '演示数据',
    updatedAt: new Date().toISOString(),
    usage: {
      short: { label: '5 小时额度', used: 54, reset: '今天 21:26' },
      week: { label: '1 周额度', used: 65, reset: '9 月 9 日 09:14' },
      credits: 0,
      resets: 1
    },
    activities: [
      { title: '设计 OpenAI 用量桌面助手', sub: '正在运行 · 刚刚有活动', tag: '运行中', tone: 'run' },
      { title: '总结七日密室文件内容', sub: '已有未读动态', tag: '就绪', tone: 'ready' },
      { title: '海错图项目', sub: '等待下一步输入', tag: '需要输入', tone: 'blocked' }
    ],
    permissions: [
      { title: '需要你批准一次本地操作', sub: '当前演示：打开 ChatGPT 页面', action: '查看' }
    ]
  });

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
  }

  function normalizeSnapshot(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const usage = source.usage && typeof source.usage === 'object' ? source.usage : {};
    const demo = demoSnapshot();
    return {
      source: String(source.source || '本地桥接'),
      updatedAt: source.updatedAt || new Date().toISOString(),
      usage: {
        short: { ...demo.usage.short, ...(usage.short || {}), used: number(usage.short?.used, demo.usage.short.used) },
        week: { ...demo.usage.week, ...(usage.week || {}), used: number(usage.week?.used, demo.usage.week.used) },
        credits: Number.isFinite(Number(usage.credits)) ? Number(usage.credits) : demo.usage.credits,
        resets: Number.isFinite(Number(usage.resets)) ? Number(usage.resets) : demo.usage.resets
      },
      activities: Array.isArray(source.activities) ? source.activities.slice(0, 20).map((item) => ({
        title: String(item.title || '未命名任务'),
        sub: String(item.sub || item.status || '无状态'),
        tag: String(item.tag || '就绪'),
        tone: ['run', 'ready', 'blocked'].includes(item.tone) ? item.tone : 'ready'
      })) : demo.activities,
      permissions: Array.isArray(source.permissions) ? source.permissions.slice(0, 20).map((item) => ({
        title: String(item.title || '待处理请求'),
        sub: String(item.sub || item.description || '需要你的决定'),
        action: String(item.action || '查看')
      })) : demo.permissions
    };
  }

  class DemoProvider {
    async read() { return demoSnapshot(); }
  }

  class BridgeProvider {
    constructor(url) { this.url = url; }

    async read() {
      if (!this.url) throw new Error('尚未配置本地数据桥接地址');
      const response = await fetch(this.url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`数据桥接返回 HTTP ${response.status}`);
      return normalizeSnapshot(await response.json());
    }
  }

  window.assistantDataProvider = {
    create(config = {}) {
      return config.dataSourceMode === 'bridge' ? new BridgeProvider(config.bridgeUrl) : new DemoProvider();
    },
    normalize: normalizeSnapshot,
    demo: demoSnapshot
  };
})();

const api = require('../../utils/api');
const app = getApp();

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// epoch 毫秒 → "2026-03-03 18:03:19"（设备本地时区）
function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

Page({
  data: {
    loading: true,
    openid: '',
    user: null,
    target: 3,
    periods: [],
    current: 0,
    sponsorBadge: '💎', // 赞助徽标文案，取自 remoteConfig
  },

  onLoad(options) {
    const openid = options.openid || '';
    if (!openid) {
      wx.showToast({ title: '参数缺失', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({ openid, sponsorBadge: app.globalData.remoteConfig.sponsorBadge });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.request(`/api/stats/user/${encodeURIComponent(this.data.openid)}`);
      const periods = (data.periods || []).map((p) => ({
        ...p,
        list: p.list.map((r) => {
          const d = new Date(r.date + 'T00:00:00');
          return {
            ...r,
            weekday: WEEKDAYS[d.getDay()],
            // 提交时间精确到时分秒；无时间信息的来源显示 00:00:00
            timeText: r.createdAt ? formatDateTime(r.createdAt) : `${r.date} 00:00:00`,
          };
        }),
      }));
      this.setData({ user: data.user, target: data.target, periods });
      if (data.user && data.user.nickname) {
        wx.setNavigationBarTitle({ title: data.user.nickname });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTapTab(e) {
    this.setData({ current: e.currentTarget.dataset.index });
  },
});

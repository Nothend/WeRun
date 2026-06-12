const api = require('../../utils/api');

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
    scope: 'week',
    loading: true,
    count: 0,
    totalMinutes: 0,
    list: [],
  },

  onLoad(options) {
    const scope = options.scope === 'all' ? 'all' : 'week';
    this.setData({ scope });
    wx.setNavigationBarTitle({ title: scope === 'week' ? '本周打卡明细' : '全部打卡记录' });
    this.loadRecords();
  },

  async loadRecords() {
    this.setData({ loading: true });
    try {
      const data = await api.request(`/api/stats/me/checkins?scope=${this.data.scope}`);
      const list = data.list.map((r) => {
        const d = new Date(r.date + 'T00:00:00');
        return {
          ...r,
          weekday: WEEKDAYS[d.getDay()],
          // 提交时间精确到时分秒；无时间信息的来源显示 00:00:00
          timeText: r.createdAt ? formatDateTime(r.createdAt) : `${r.date} 00:00:00`,
        };
      });
      this.setData({ count: data.count, totalMinutes: data.totalMinutes, list });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});

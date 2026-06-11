const api = require('../../utils/api');

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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
        return { ...r, weekday: WEEKDAYS[d.getDay()] };
      });
      this.setData({ count: data.count, totalMinutes: data.totalMinutes, list });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});

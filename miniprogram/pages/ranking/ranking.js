const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    data: null, // { weekKey, target, achievedCount, total, list }
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.request('/api/stats/group');
      this.setData({ data });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});

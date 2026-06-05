const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    loading: true,
    data: null, // { weekKey, target, achievedCount, total, list }
    isAdmin: false,
    // 群总览分享（管理员）
    shareGroupText: '',
    shareGroupLoading: false,
    showShareGroupModal: false,
  },

  onShareAppMessage() {
    return {
      title: this.data.shareGroupText || 'WeRun 跑步群周榜，一起来运动！',
      path: '/pages/ranking/ranking',
    };
  },

  onShow() {
    const user = app.globalData.user;
    this.setData({ isAdmin: !!(user && user.isAdmin) });
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

  // ── 群总览分享（管理员）────────────────────────────────
  async openGroupShareModal() {
    if (this.data.shareGroupLoading) return;
    this.setData({ shareGroupLoading: true });
    try {
      const data = await api.request('/api/share/group');
      this.setData({ shareGroupText: data.text, showShareGroupModal: true });
    } catch (e) {
      wx.showToast({ title: e.message || '生成文案失败', icon: 'none' });
    } finally {
      this.setData({ shareGroupLoading: false });
    }
  },

  closeGroupShareModal() {
    this.setData({ showShareGroupModal: false });
  },

  copyGroupShareText() {
    wx.setClipboardData({
      data: this.data.shareGroupText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },
});

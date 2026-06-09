const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    user: null,
    loggingIn: false,
    avatarUrl: '',
    nickname: '',
    stats: null,
    shareText: '',
    shareLoading: false,
    showShareModal: false,
  },

  onShareAppMessage() {
    return {
      title: this.data.shareText || '我在 WeRun 坚持跑步打卡，快来一起运动！',
      path: '/pages/index/index',
    };
  },

  onShow() {
    const user = app.globalData.user;
    this.setData({
      user,
      avatarUrl: user ? user.avatarUrl : '',
      nickname: user ? user.nickname : '',
    });
    if (user) this.loadStats();
  },

  // 实际执行登录，不带确认弹窗（用于用户主动点击「微信登录」）
  async doLogin() {
    if (this.data.loggingIn) return false;
    this.setData({ loggingIn: true });
    try {
      const { user, isNewUser } = await api.login();
      app.fetchConfig();
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname });
      this.loadStats();
      if (isNewUser) {
        wx.navigateTo({ url: '/pages/profile/profile?mode=auth' });
      }
      return true;
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      return false;
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  handleLogin() {
    this.doLogin();
  },

  // 进入需要登录的功能前先征求同意，用户可选择暂不登录
  requireLogin(content) {
    if (this.data.user) return Promise.resolve(true);
    return new Promise((resolve) => {
      wx.showModal({
        title: '需要登录',
        content,
        confirmText: '去登录',
        cancelText: '暂不',
        success: async (res) => {
          if (!res.confirm) { resolve(false); return; }
          resolve(await this.doLogin());
        },
        fail: () => resolve(false),
      });
    });
  },

  async loadStats() {
    try {
      const stats = await api.request('/api/stats/me');
      this.setData({ stats });
    } catch (e) {
      // 静默
    }
  },

  deleteCheckinToday() {
    wx.showModal({
      title: '撤销今日打卡',
      content: '确认删除今天的打卡记录？删除后可重新打卡。',
      confirmText: '确认',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request('/api/checkin/today', { method: 'DELETE' });
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.loadStats();
        } catch (e) {
          wx.showToast({ title: e.message || '撤销失败', icon: 'none' });
        }
      },
    });
  },

  // ── 分享 ──────────────────────────────────────────────
  async openShareModal() {
    const ok = await this.requireLogin('分享运动数据需要先登录微信账号，是否登录？');
    if (!ok || this.data.shareLoading) return;
    this.setData({ shareLoading: true });
    try {
      const data = await api.request('/api/share/me');
      this.setData({ shareText: data.text, showShareModal: true });
    } catch (e) {
      wx.showToast({ title: e.message || '生成文案失败', icon: 'none' });
    } finally {
      this.setData({ shareLoading: false });
    }
  },

  closeShareModal() {
    this.setData({ showShareModal: false });
  },

  copyShareText() {
    wx.setClipboardData({
      data: this.data.shareText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },

  // ── 个人资料 ───────────────────────────────────────────
  onProfileTap() {
    if (this.data.user) {
      wx.navigateTo({ url: '/pages/profile/profile' });
    } else {
      this.handleLogin();
    }
  },

  // ── 导航 ──────────────────────────────────────────────
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          app.clearAuth();
          this.setData({ user: null, avatarUrl: '', nickname: '', stats: null });
        }
      },
    });
  },

  async goCheckin() {
    const ok = await this.requireLogin('打卡需要先登录微信账号，是否登录？');
    if (!ok) return;
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },
  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },
});

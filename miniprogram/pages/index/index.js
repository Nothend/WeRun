const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    user: null,
    loggingIn: false,
    avatarUrl: '',
    nickname: '',
    stats: null,
    isPending: false,
    nicknameIsDefault: false,
  },

  onShareAppMessage() {
    return {
      title: '我在 WeRun 坚持跑步打卡，快来一起运动！',
      path: '/pages/index/index',
    };
  },

  onShow() {
    const user = app.globalData.user;
    const isPending = !!(user && user.status === 'pending');
    const nicknameIsDefault = isPending && (!user.nickname || /^跑友.{4}$/.test(user.nickname));
    this.setData({
      user,
      avatarUrl: user ? user.avatarUrl : '',
      nickname: user ? user.nickname : '',
      isPending,
      nicknameIsDefault,
    });
    if (user && !isPending) this.loadStats();
  },

  // 实际执行登录，不带确认弹窗（用于用户主动点击「微信登录」）
  async doLogin() {
    if (this.data.loggingIn) return false;
    this.setData({ loggingIn: true });
    try {
      const { user, isNewUser } = await api.login();
      app.fetchConfig();
      const isPending = user.status === 'pending';
      const nicknameIsDefault = isPending && (!user.nickname || /^跑友.{4}$/.test(user.nickname));
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname, isPending, nicknameIsDefault });
      if (!isPending) this.loadStats();
      if (isPending) {
        wx.navigateTo({ url: '/pages/profile/profile?mode=apply' });
      } else if (isNewUser) {
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

  // ── 打卡明细 ───────────────────────────────────────────
  openRecords(e) {
    if (!this.data.stats) return;
    const scope = e.currentTarget.dataset.scope;
    wx.navigateTo({ url: `/pages/records/records?scope=${scope}` });
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

  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },

  goApply() {
    wx.navigateTo({ url: '/pages/profile/profile?mode=apply' });
  },
  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },
  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },
});

const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    user: null,
    avatarUrl: '',
    nickname: '',
    isPending: false,
    hasApplied: false,
    loggingIn: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    const user = app.globalData.user;
    this.setData({
      user,
      avatarUrl: user ? user.avatarUrl : '',
      nickname: user ? user.nickname : '',
      isPending: !!(user && user.status === 'pending'),
      hasApplied: !!(user && user.hasApplied),
    });
  },

  async handleLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      const { user, isNewUser } = await api.login();
      app.fetchConfig();
      const isPending = user.status === 'pending';
      const hasApplied = !!user.hasApplied;
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname, isPending, hasApplied });
      if (isPending && !hasApplied) {
        wx.navigateTo({ url: '/pages/profile/profile?mode=apply' });
      } else if (isNewUser) {
        wx.navigateTo({ url: '/pages/profile/profile?mode=auth' });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  onProfileTap() {
    if (!this.data.user) { this.handleLogin(); return; }
    if (this.data.isPending && !this.data.hasApplied) {
      wx.navigateTo({ url: '/pages/profile/profile?mode=apply' });
      return;
    }
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/records/records?scope=all' });
  },
  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#fa5151',
      success: (res) => {
        if (!res.confirm) return;
        app.clearAuth();
        this.setData({ user: null, avatarUrl: '', nickname: '', isPending: false, hasApplied: false });
      },
    });
  },
});

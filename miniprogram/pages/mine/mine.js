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
    pendingCount: 0, // 待审核加入申请数（管理员），>0 时后台管理入口显红点
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
    this.loadPendingCount();
  },

  // 仅管理员：拉取待审核申请数
  async loadPendingCount() {
    const user = app.globalData.user;
    if (!user || !user.isAdmin) {
      if (this.data.pendingCount) this.setData({ pendingCount: 0 });
      return;
    }
    try {
      const { list } = await api.request('/api/admin/applications');
      this.setData({ pendingCount: (list || []).length });
    } catch (e) {
      // 静默
    }
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

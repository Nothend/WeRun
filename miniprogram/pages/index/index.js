const api = require('../../utils/api');
const config = require('../../config');
const app = getApp();

// epoch 毫秒 → 相对时间（动态均为当天，故只到「小时前」，异常兜底为「今日」）
function relTime(ms) {
  if (!ms) return '今日';
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  return '今日';
}

Page({
  data: {
    user: null,
    loggingIn: false,
    avatarUrl: '',
    nickname: '',
    stats: null,
    isPending: false,
    hasApplied: false,
    feed: [],
    feedLoaded: false,
  },

  onShareAppMessage() {
    return {
      title: '我在 WeRun 坚持跑步打卡，快来一起运动！',
      path: '/pages/index/index',
      imageUrl: config.baseUrl + '/shareground.png',
    };
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    const user = app.globalData.user;
    if (!user) { done(); return; }
    if (this.data.isPending) this.refreshMe().then(done, done);
    else { this.loadFeed(); this.loadStats().then(done, done); }
  },

  onShow() {
    const user = app.globalData.user;
    const isPending = !!(user && user.status === 'pending');
    const hasApplied = !!(user && user.hasApplied);
    this.setData({
      user,
      avatarUrl: user ? user.avatarUrl : '',
      nickname: user ? user.nickname : '',
      isPending,
      hasApplied,
    });
    if (user && !isPending) { this.loadStats(); this.loadFeed(); }
    if (user && isPending) this.refreshMe();
  },

  // 从服务端拉取最新用户状态。审核结果不会推送到客户端，
  // 待审核用户进入首页时静默刷新，也可通过横幅按钮手动刷新（showFeedback）
  async refreshMe(showFeedback) {
    if (this._refreshingMe) return;
    this._refreshingMe = true;
    try {
      const { user } = await api.request('/api/me');
      app.setUser(user);
      const isPending = user.status === 'pending';
      const hasApplied = !!user.hasApplied;
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname, isPending, hasApplied });
      if (!isPending) {
        this.loadStats();
        this.loadFeed();
        if (showFeedback) wx.showToast({ title: '审核已通过', icon: 'success' });
      } else if (showFeedback) {
        wx.showToast({ title: '仍在审核中，请耐心等待', icon: 'none' });
      }
    } catch (e) {
      // 401（被移除等）时 api.js 已清除登录态，这里同步页面回未登录状态
      if (!app.globalData.user) {
        this.setData({ user: null, avatarUrl: '', nickname: '', stats: null, isPending: false, hasApplied: false });
      }
      if (showFeedback) wx.showToast({ title: e.message || '刷新失败', icon: 'none' });
    } finally {
      this._refreshingMe = false;
    }
  },

  onRefreshStatus() {
    this.refreshMe(true);
  },

  // 实际执行登录，不带确认弹窗（用于用户主动点击「微信登录」）
  async doLogin() {
    if (this.data.loggingIn) return false;
    this.setData({ loggingIn: true });
    try {
      const { user, isNewUser } = await api.login();
      app.fetchConfig();
      const isPending = user.status === 'pending';
      const hasApplied = !!user.hasApplied;
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname, isPending, hasApplied });
      if (!isPending) { this.loadStats(); this.loadFeed(); }
      if (isPending && !hasApplied) {
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

  // 今日打卡动态（仅当天，按提交时间倒序）
  async loadFeed() {
    try {
      const { list } = await api.request('/api/stats/feed');
      const feed = list.map((r) => ({ ...r, timeText: relTime(r.createdAt) }));
      this.setData({ feed, feedLoaded: true });
    } catch (e) {
      this.setData({ feedLoaded: true });
    }
  },

  deleteCheckinToday() {
    wx.showModal({
      title: '撤销今日打卡',
      content: '确认删除今天的打卡记录？删除后可重新打卡。',
      confirmText: '确认',
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request('/api/checkin/today', { method: 'DELETE' });
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.loadStats();
          this.loadFeed();
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

  // 点击动态项查看该成员打卡明细
  goUser(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({ url: `/pages/user/user?openid=${encodeURIComponent(openid)}` });
  },

  // ── 个人资料 ───────────────────────────────────────────
  onProfileTap() {
    if (!this.data.user) {
      this.handleLogin();
      return;
    }
    if (this.data.isPending && !this.data.hasApplied) {
      this.goApply();
      return;
    }
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // ── 导航 ──────────────────────────────────────────────
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#fa5151',
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

const api = require('../../utils/api');
const config = require('../../config');
const app = getApp();

const SPONSOR_QR_URL = config.baseUrl + '/public/wechat.png';

Page({
  data: {
    user: null,
    loggingIn: false,
    avatarUrl: '',
    nickname: '',
    stats: null,
    showSponsor: false,
    sponsorQrUrl: SPONSOR_QR_URL,
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

  async handleLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      const { user, isNewUser } = await api.login();
      app.fetchConfig();
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname });
      this.loadStats();
      if (isNewUser) {
        wx.navigateTo({ url: '/pages/profile/profile?mode=auth' });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  async loadStats() {
    try {
      const stats = await api.request('/api/stats/me');
      this.setData({ stats });
    } catch (e) {
      // 静默
    }
  },

  // ── 分享 ──────────────────────────────────────────────
  async openShareModal() {
    if (this.data.shareLoading) return;
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

  // ── 编辑资料 ───────────────────────────────────────────
  openProfilePage() {
    wx.navigateTo({ url: '/pages/profile/profile' });
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
  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },
  openSponsor() {
    this.setData({ showSponsor: true });
  },
  closeSponsor() {
    this.setData({ showSponsor: false });
  },
});

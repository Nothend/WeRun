const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    user: null,
    loggingIn: false,
    // 资料编辑
    avatarUrl: '',
    nickname: '',
    saving: false,
    // 本周状态
    stats: null,
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
      const user = await api.login();
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname });
      this.loadStats();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  // 头像选择（开放能力）
  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl });
  },
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  async saveProfile() {
    if (this.data.saving) return;
    if (!this.data.nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      let data;
      // 若头像是本地临时文件则上传，否则只更新昵称
      if (this.data.avatarUrl && /^(http|wxfile|cloud|wx):/.test(this.data.avatarUrl) === false) {
        data = await api.upload('/api/profile', this.data.avatarUrl, {
          name: 'avatar',
          formData: { nickname: this.data.nickname },
        });
      } else if (this.data.avatarUrl && this.data.avatarUrl.startsWith('http')) {
        // 头像未变（已是服务器 URL），仅提交昵称
        data = await api.request('/api/profile', {
          method: 'POST',
          data: { nickname: this.data.nickname },
        });
      } else {
        data = await api.upload('/api/profile', this.data.avatarUrl, {
          name: 'avatar',
          formData: { nickname: this.data.nickname },
        });
      }
      app.setUser(data.user);
      this.setData({ user: data.user, avatarUrl: data.user.avatarUrl });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
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

  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },
  goRanking() {
    wx.navigateTo({ url: '/pages/ranking/ranking' });
  },
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },
});

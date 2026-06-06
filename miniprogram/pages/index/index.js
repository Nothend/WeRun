const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    user: null,
    loggingIn: false,
    avatarUrl: '',
    nickname: '',
    stats: null,
    showSponsor: false,
    shareText: '',
    shareLoading: false,
    showShareModal: false,
    showProfileModal: false,
    editNickname: '',
    editAvatarTemp: '',
    saving: false,
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
      const user = await api.login();
      app.fetchConfig();
      this.setData({ user, avatarUrl: user.avatarUrl, nickname: user.nickname });
      this.loadStats();
      // 首次登录无昵称，引导完善资料（由用户点击登录按钮触发，非自动弹窗）
      if (!user.nickname) {
        this.setData({ showProfileModal: true, editNickname: '', editAvatarTemp: '' });
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
  openProfileModal() {
    this.setData({ showProfileModal: true, editNickname: this.data.nickname, editAvatarTemp: '' });
  },

  closeProfileModal() {
    this.setData({ showProfileModal: false });
  },

  onChooseAvatar(e) {
    this.setData({ editAvatarTemp: e.detail.avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ editNickname: e.detail.value });
  },

  async saveProfile() {
    if (this.data.saving) return;
    const { editNickname, editAvatarTemp, nickname } = this.data;
    const finalNickname = (editNickname || '').trim() || nickname;
    if (!finalNickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      let result;
      if (editAvatarTemp && editAvatarTemp.startsWith('https://')) {
        // 微信 chooseAvatar 返回 CDN 地址，直接传给服务端存库，无需上传文件
        result = await api.request('/api/profile', {
          method: 'POST',
          data: { nickname: finalNickname, avatarUrl: editAvatarTemp },
        });
      } else if (editAvatarTemp) {
        // 本地文件路径（兼容旧格式）：文件上传
        result = await api.upload('/api/profile', editAvatarTemp, {
          name: 'avatar',
          formData: { nickname: finalNickname },
        });
      } else {
        result = await api.request('/api/profile', { method: 'POST', data: { nickname: finalNickname } });
      }
      app.setUser(result.user);
      this.setData({
        user: result.user,
        nickname: result.user.nickname,
        avatarUrl: result.user.avatarUrl,
        showProfileModal: false,
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
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

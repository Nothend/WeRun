const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    authMode: false,
    nickname: '',
    previewUrl: '',
    avatarTemp: '',
    saving: false,
  },

  onLoad(options) {
    const authMode = options.mode === 'auth';
    const user = app.globalData.user;
    this.setData({
      authMode,
      nickname: user ? user.nickname : '',
      previewUrl: user ? user.avatarUrl : '',
    });
    if (authMode) {
      wx.setNavigationBarTitle({ title: '' });
    }
  },

  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    this.setData({ avatarTemp: url, previewUrl: url });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  skip() {
    wx.navigateBack();
  },

  async save() {
    if (this.data.saving) return;
    const { nickname, avatarTemp } = this.data;
    const finalNickname = (nickname || '').trim();
    if (!finalNickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      let result;
      if (avatarTemp) {
        if (avatarTemp.startsWith('https://')) {
          result = await api.request('/api/profile', {
            method: 'POST',
            data: { nickname: finalNickname, avatarUrl: avatarTemp },
          });
        } else {
          result = await api.upload('/api/profile', avatarTemp, {
            name: 'avatar',
            formData: { nickname: finalNickname },
          });
        }
      } else {
        result = await api.request('/api/profile', {
          method: 'POST',
          data: { nickname: finalNickname },
        });
      }
      app.setUser(result.user);
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});

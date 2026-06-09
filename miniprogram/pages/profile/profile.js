const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    authMode: false,
    applyMode: false,
    nickname: '',
    previewUrl: '',
    avatarTemp: '',
    saving: false,
    canSubmit: false, // applyMode 专用：头像+昵称都主动填写后才允许提交
  },

  onLoad(options) {
    const authMode = options.mode === 'auth';
    const applyMode = options.mode === 'apply';
    const user = app.globalData.user;
    this.setData({
      authMode,
      applyMode,
      // 申请模式必须主动填写，不预填已有值，防止默认昵称被当作"已填写"
      nickname:   applyMode ? '' : (user ? user.nickname  : ''),
      previewUrl: applyMode ? '' : (user ? user.avatarUrl : ''),
      canSubmit: false,
    });
    if (authMode)  wx.setNavigationBarTitle({ title: '' });
    if (applyMode) wx.setNavigationBarTitle({ title: '提交加入申请' });
  },

  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    this.setData({ avatarTemp: url, previewUrl: url });
    this._updateCanSubmit();
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
    this._updateCanSubmit();
  },

  _updateCanSubmit() {
    if (!this.data.applyMode) return;
    const { avatarTemp, nickname } = this.data;
    this.setData({ canSubmit: avatarTemp !== '' && (nickname || '').trim().length >= 2 });
  },

  skip() {
    wx.navigateBack();
  },

  async save() {
    if (this.data.saving) return;
    const { nickname, avatarTemp, applyMode, canSubmit } = this.data;
    const finalNickname = (nickname || '').trim();

    if (applyMode) {
      if (!canSubmit) return; // 按钮已禁用时的防御
      this.setData({ saving: true });
      try {
        let result;
        if (avatarTemp.startsWith('https://')) {
          result = await api.request('/api/apply', {
            method: 'POST',
            data: { nickname: finalNickname, avatarUrl: avatarTemp },
          });
        } else {
          result = await api.upload('/api/apply', avatarTemp, {
            name: 'avatar',
            formData: { nickname: finalNickname },
          });
        }
        app.setUser(result.user);
        wx.showToast({ title: '申请已提交，等待审核', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } catch (e) {
        wx.showToast({ title: e.message || '提交失败', icon: 'none' });
      } finally {
        this.setData({ saving: false });
      }
      return;
    }

    // ── 普通资料编辑 ──
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

const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    imagePath: '',
    submitting: false,
    result: null, // { success, reason, duration, weekCount, target, achieved, already }
    minDurationMinutes: 30,
  },

  onLoad() {
    this.setData({ minDurationMinutes: app.globalData.remoteConfig.minDurationMinutes });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ imagePath: res.tempFiles[0].tempFilePath, result: null });
      },
    });
  },

  async submit() {
    if (!this.data.imagePath) {
      wx.showToast({ title: '请先选择截图', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true, result: null });
    wx.showLoading({ title: '识别中...' });
    try {
      const data = await api.upload('/api/checkin', this.data.imagePath, { name: 'image' });
      this.setData({ result: data });
      if (data.success) {
        wx.showToast({ title: '打卡成功！', icon: 'success' });
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack();
  },
});

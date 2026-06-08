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

  onShow() {
    this.consumePendingMaterial();
  },

  // 从微信聊天素材直接打开时，自动取图、识别并打卡
  async consumePendingMaterial() {
    const material = app.globalData.pendingMaterial;
    if (!material || this.data.submitting) return;
    app.globalData.pendingMaterial = null; // 只消费一次

    if (!app.globalData.user) {
      const loggedIn = await this.ensureLogin();
      if (!loggedIn) return;
    }

    try {
      const filePath = await this.resolveMaterialPath(material.path);
      this.setData({ imagePath: filePath, result: null });
      this.submit();
    } catch (e) {
      wx.showToast({ title: e.message || '图片读取失败', icon: 'none' });
    }
  },

  // 聊天素材的 path 可能是本地临时路径，也可能是 url，url 需先下载成本地文件才能上传
  resolveMaterialPath(path) {
    return new Promise((resolve, reject) => {
      if (!/^https?:\/\//i.test(path)) {
        resolve(path);
        return;
      }
      wx.downloadFile({
        url: path,
        success: (res) => {
          if (res.statusCode === 200) resolve(res.tempFilePath);
          else reject(new Error('图片下载失败'));
        },
        fail: (err) => reject(new Error(err.errMsg || '图片下载失败')),
      });
    });
  },

  ensureLogin() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '需要先登录',
        content: '识别打卡截图前请先登录 WeRun',
        confirmText: '去登录',
        success: async (res) => {
          if (!res.confirm) { resolve(false); return; }
          try {
            await api.login();
            app.fetchConfig();
            this.setData({ minDurationMinutes: app.globalData.remoteConfig.minDurationMinutes });
            resolve(true);
          } catch (e) {
            wx.showToast({ title: e.message, icon: 'none' });
            resolve(false);
          }
        },
        fail: () => resolve(false),
      });
    });
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

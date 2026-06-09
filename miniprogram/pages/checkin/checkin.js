const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    imagePath: '',
    submitting: false,
    result: null, // { success, reason, duration, weekCount, target, achieved, already }
    minDurationMinutes: 30,
    isPending: false,
  },

  onLoad() {
    this.setData({ minDurationMinutes: app.globalData.remoteConfig.minDurationMinutes });
  },

  onShow() {
    const user = app.globalData.user;
    const isPending = !!(user && user.status === 'pending');
    this.setData({ isPending });
    if (!isPending) this.consumePendingMaterial();
  },

  // 从微信聊天素材直接打开时，自动取图、识别并打卡
  async consumePendingMaterial() {
    const material = app.globalData.pendingMaterial;
    if (!material || this.data.submitting) return;
    // 素材带时间戳时，若不是今天（本地日期）则视为过期丢弃，防止昨天或更早的聊天截图误触发
    if (material.ts) {
      const matDay = new Date(material.ts);
      const nowDay = new Date();
      if (matDay.toDateString() !== nowDay.toDateString()) {
        app.globalData.pendingMaterial = null;
        return;
      }
    }
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

    if (!app.globalData.user) {
      const loggedIn = await this.ensureLogin();
      if (!loggedIn) return;
    }

    this.setData({ submitting: true, result: null });
    wx.showLoading({ title: '识别中...' });
    try {
      const data = await api.upload('/api/checkin', this.data.imagePath, { name: 'image' });
      this.setData({ result: data });
      if (data.success) {
        wx.showToast({ title: '打卡成功！', icon: 'success' });
        // 攒一次「每周打卡周报」订阅额度，用于周日自动推送
        const weeklyTmpl = app.globalData.remoteConfig.weeklyTemplateId;
        if (weeklyTmpl) {
          wx.requestSubscribeMessage({
            tmplIds: [weeklyTmpl],
            fail: () => {}, // 用户拒绝或环境不支持时静默忽略
          });
        }
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  deleteCheckin() {
    wx.showModal({
      title: '撤销今日打卡',
      content: '确认删除今天的打卡记录？删除后可重新打卡。',
      confirmText: '确认',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request('/api/checkin/today', { method: 'DELETE' });
          wx.showToast({ title: '已撤销', icon: 'success' });
          this.setData({ result: null, imagePath: '' });
        } catch (e) {
          wx.showToast({ title: e.message || '撤销失败', icon: 'none' });
        }
      },
    });
  },

  goBack() {
    wx.navigateBack();
  },
});

const config = require('./config');

App({
  globalData: {
    token: '',
    user: null, // { openid, nickname, avatarUrl, isAdmin }
    remoteConfig: { minDurationMinutes: 30, weeklyTarget: 3, applyTemplateId: '', weeklyTemplateId: '' }, // 默认值，拉取成功后覆盖
    pendingMaterial: null, // 从微信聊天素材打开时待识别的图片 { path, name }
  },
  onLaunch(options) {
    const token = wx.getStorageSync('token');
    const user = wx.getStorageSync('user');
    if (token) this.globalData.token = token;
    if (user) this.globalData.user = user;
    // 已登录时才拉取配置，未登录不请求任何接口
    if (token) this.fetchConfig();
    this.captureForwardMaterial(options);
  },
  onShow(options) {
    this.captureForwardMaterial(options);
  },

  // 从微信聊天素材直接打开小程序时（scene 1173），options 中带 forwardMaterials 数组
  captureForwardMaterial(options) {
    const materials = options && options.forwardMaterials;
    if (!Array.isArray(materials) || !materials.length) return;
    const image = materials.find((m) => m.type && m.type.indexOf('image') === 0);
    if (image) this.globalData.pendingMaterial = { path: image.path, name: image.name || '', ts: Date.now() };
  },

  fetchConfig() {
    wx.request({
      url: config.baseUrl + '/api/config',
      method: 'GET',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          this.globalData.remoteConfig = res.data;
        }
      },
    });
  },
  setAuth(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync('token', token);
    wx.setStorageSync('user', user);
  },
  setUser(user) {
    this.globalData.user = user;
    wx.setStorageSync('user', user);
  },
  clearAuth() {
    this.globalData.token = '';
    this.globalData.user = null;
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
  },
});

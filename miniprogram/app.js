App({
  globalData: {
    token: '',
    user: null, // { openid, nickname, avatarUrl, isAdmin }
  },
  onLaunch() {
    const token = wx.getStorageSync('token');
    const user = wx.getStorageSync('user');
    if (token) this.globalData.token = token;
    if (user) this.globalData.user = user;
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

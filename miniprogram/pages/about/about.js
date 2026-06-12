const config = require('../../config');

const app = getApp();

// 关于作者页：纯静态展示，不需要登录，匿名用户也可查看
Page({
  data: {
    payQrUrl: config.baseUrl + '/public/wechatpay.png',
    // 支持区块（成本说明+赞赏码）由服务器开关控制，默认隐藏（平台审核要求）
    showSupport: false,
  },

  onShow() {
    this.setData({ showSupport: !!app.globalData.remoteConfig.showSupport });
  },

  previewQr() {
    wx.previewImage({ urls: [this.data.payQrUrl] });
  },
});

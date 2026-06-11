const config = require('../../config');

// 关于作者页：纯静态展示，不需要登录，匿名用户也可查看
Page({
  data: {
    payQrUrl: config.baseUrl + '/public/wechatpay.png',
  },

  previewQr() {
    wx.previewImage({ urls: [this.data.payQrUrl] });
  },
});

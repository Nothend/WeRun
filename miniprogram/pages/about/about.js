const config = require('../../config');
const api = require('../../utils/api');

const app = getApp();

// 关于作者页：纯静态展示，不需要登录，匿名用户也可查看
Page({
  data: {
    payQrUrl: config.baseUrl + '/public/wechatpay.png',
    // 支持区块（成本说明+赞赏码）由服务器开关控制，默认隐藏（平台审核要求）
    showSupport: false,
    // 更新日志（由服务端从 git 标签自动生成）
    changelog: [],
    versionCount: 0,
    firstDate: '',
  },

  onLoad() {
    this.loadChangelog();
  },

  onShow() {
    this.setData({ showSupport: !!app.globalData.remoteConfig.showSupport });
  },

  async loadChangelog() {
    try {
      const data = await api.request('/api/changelog');
      this.setData({
        changelog: data.list || [],
        versionCount: data.count || 0,
        firstDate: data.firstDate || '',
      });
    } catch (e) {
      // 静默：拉取失败时不展示更新日志区块
    }
  },

  previewQr() {
    wx.previewImage({ urls: [this.data.payQrUrl] });
  },
});

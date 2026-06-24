const api = require('../utils/api');
const app = getApp();

Component({
  data: {
    selected: 0,
    adminDot: false, // 管理员有待审核加入申请时，「我的」显红点
    list: [
      { pagePath: 'pages/index/index', text: '首页', icon: 'home' },
      { pagePath: 'pages/ranking/ranking', text: '排行榜', icon: 'trophy' },
      { pagePath: 'pages/mine/mine', text: '我的', icon: 'user' },
    ],
  },
  lifetimes: {
    // 每个 tab 页各自创建一份 tabBar 实例，挂载时先采用全局已知的红点状态，
    // 不依赖页面在正确时机回调 refreshAdminDot（正式版跨组件 setData 时序不稳）
    attached() {
      if (app.globalData.adminDot) this.setData({ adminDot: true });
    },
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const url = '/' + this.data.list[idx].pagePath;
      wx.switchTab({ url });
    },
    // 仅管理员：拉取待审核申请数，有则在「我的」显红点；结果写回 globalData 作为唯一来源
    refreshAdminDot() {
      const user = app.globalData.user;
      if (!user || !user.isAdmin) {
        app.globalData.adminDot = false;
        if (this.data.adminDot) this.setData({ adminDot: false });
        return;
      }
      api.request('/api/admin/applications')
        .then(({ list }) => {
          const dot = (list || []).length > 0;
          app.globalData.adminDot = dot;
          this.setData({ adminDot: dot });
        })
        .catch(() => {});
    },
  },
});

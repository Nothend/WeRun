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
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const url = '/' + this.data.list[idx].pagePath;
      wx.switchTab({ url });
    },
    // 仅管理员：拉取待审核申请数，有则在「我的」显红点
    refreshAdminDot() {
      const user = app.globalData.user;
      if (!user || !user.isAdmin) {
        if (this.data.adminDot) this.setData({ adminDot: false });
        return;
      }
      api.request('/api/admin/applications')
        .then(({ list }) => this.setData({ adminDot: (list || []).length > 0 }))
        .catch(() => {});
    },
  },
});

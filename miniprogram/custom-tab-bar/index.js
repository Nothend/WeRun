Component({
  data: {
    selected: 0,
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
  },
});

// 滚动公告栏：自取 remoteConfig.noticeText，并处理首屏配置尚未就绪的竞态。
// 空文本时不渲染。除管理后台外的页面，以及打卡核验等待遮罩，均复用本组件。
Component({
  data: { text: '' },
  lifetimes: {
    attached() {
      const app = getApp();
      const rc = app.globalData.remoteConfig || {};
      this.setData({ text: rc.noticeText || '' });
      // 首屏 onShow 可能早于 /api/config 返回，配置就绪后补刷一次
      if (!app.globalData.configLoaded) {
        app.fetchConfig().then((cfg) => {
          this.setData({ text: (cfg && cfg.noticeText) || '' });
        });
      }
    },
  },
});

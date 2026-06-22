const api = require('../../utils/api');
const config = require('../../config');
const app = getApp();

const PAGE_SIZE = 10;

// 哪些榜单可生成对应的金主报告海报（本周需周五22:00后，由后端把关）
const REPORT_PERIOD = { thisWeek: 'week', lastWeek: 'lastweek', thisMonth: 'month', thisYear: 'year' };

// 未登录/待审核时展示的空壳榜单结构，与后端 /api/stats/rankings 的标签保持一致
const PLACEHOLDER_BOARDS = [
  { key: 'today', label: '今日', weekly: false, list: [] },
  { key: 'thisWeek', label: '本周', weekly: true, list: [] },
  { key: 'lastWeek', label: '上周', weekly: true, list: [] },
  { key: 'thisMonth', label: '本月', weekly: false, list: [] },
  { key: 'lastMonth', label: '上月', weekly: false, list: [] },
  { key: 'thisYear', label: '本年', weekly: false, list: [] },
  { key: 'allTime', label: '总榜', weekly: false, list: [] },
];

Page({
  data: {
    loading: true,
    target: 3,
    boards: [], // 视图用榜单（含 top3 / 分页后的 rest）
    current: 0, // 当前 swiper 下标
    swiperHeight: 0, // swiper 高度（px），按屏幕动态计算
    isAdmin: false,
    reportLoading: '', // 正在生成的报告周期（week/month/year），用于按钮 loading 态
  },

  onShareAppMessage() {
    return {
      title: 'WeRun 跑步群周榜，一起来运动！',
      path: '/pages/ranking/ranking',
      imageUrl: config.baseUrl + '/shareground.png',
    };
  },

  // 朋友圈分享（封面图按 1:1 居中裁切）
  onShareTimeline() {
    return {
      title: 'WeRun 跑步群周榜，一起来运动！',
      imageUrl: config.baseUrl + '/shareground.png',
    };
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    const user = app.globalData.user;
    if (user && user.status !== 'pending') this.load().then(done, done);
    else done();
  },

  onLoad() {
    // 计算 swiper 可用高度：屏幕高度 - 顶部标签栏(约 88rpx)
    try {
      const info = wx.getWindowInfo();
      const rpx2px = info.windowWidth / 750;
      const tabsPx = 96 * rpx2px; // 标签栏高度
      this.setData({ swiperHeight: info.windowHeight - tabsPx });
    } catch (e) {
      // ignore，保留默认
    }
  },

  onShow() {
    const user = app.globalData.user;
    const isPending = !!(user && user.status === 'pending');
    this.setData({ isAdmin: !!(user && user.isAdmin) });
    if (user && !isPending) {
      this.load();
    } else {
      const boards = PLACEHOLDER_BOARDS.map((b) => this.buildBoardView(b));
      this.setData({ loading: false, boards });
    }
  },

  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.request('/api/stats/rankings');
      const boards = (data.boards || []).map((b) => this.buildBoardView(b));
      this.setData({ target: data.target, boards });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 把后端单个榜单转成视图结构：前三名 + 分页后的第四名起列表
  buildBoardView(b, page = 0) {
    const ranked = b.list.map((item, i) => ({ ...item, rank: i + 1 }));
    const top3 = ranked.slice(0, 3);
    const rest = ranked.slice(3);
    const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
    const p = Math.min(page, totalPages - 1);
    const visibleRest = rest.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
    return {
      key: b.key,
      label: b.label,
      weekly: b.weekly,
      reportPeriod: REPORT_PERIOD[b.key] || '',
      total: b.list.length,
      top3,
      rest,
      page: p,
      totalPages,
      visibleRest,
    };
  },

  // ── 点头像查看成员主页 ────────────────────────────────
  goUser(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.navigateTo({ url: `/pages/user/user?openid=${encodeURIComponent(openid)}` });
  },

  // ── 标签 / 滑动切换 ────────────────────────────────
  onSwiperChange(e) {
    this.setData({ current: e.detail.current });
  },

  onTapTab(e) {
    this.setData({ current: e.currentTarget.dataset.index });
  },

  // ── 列表分页（第四名起，每页 10 人）────────────────
  onPrevPage(e) {
    this.changePage(e.currentTarget.dataset.index, -1);
  },

  onNextPage(e) {
    this.changePage(e.currentTarget.dataset.index, 1);
  },

  changePage(idx, delta) {
    const board = this.data.boards[idx];
    if (!board) return;
    const nextPage = board.page + delta;
    if (nextPage < 0 || nextPage >= board.totalPages) return;
    const rebuilt = this.buildBoardView(
      { key: board.key, label: board.label, weekly: board.weekly, list: [...board.top3, ...board.rest] },
      nextPage
    );
    this.setData({ [`boards[${idx}]`]: rebuilt });
  },

  // ── 生成金主报告海报（管理员）────────────────────────
  // 请求后端渲染好的 PNG URL，用 previewImage 打开；长按可转发到群/朋友圈或保存相册
  async genReport(e) {
    const period = e.currentTarget.dataset.period;
    if (!period || this.data.reportLoading) return;
    this.setData({ reportLoading: period });
    try {
      const data = await api.request(`/api/report/${period}`);
      if (data.notice) {
        await new Promise((resolve) =>
          wx.showModal({ title: '提示', content: data.notice, showCancel: false, success: resolve })
        );
      }
      wx.previewImage({ urls: [data.url], current: data.url });
    } catch (err) {
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    } finally {
      this.setData({ reportLoading: '' });
    }
  },
});

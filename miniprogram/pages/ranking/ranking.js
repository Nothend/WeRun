const api = require('../../utils/api');
const app = getApp();

const PAGE_SIZE = 10;

Page({
  data: {
    loading: true,
    loggedIn: false,
    loggingIn: false,
    isPending: false,
    target: 3,
    boards: [], // 视图用榜单（含 top3 / 分页后的 rest）
    current: 0, // 当前 swiper 下标
    swiperHeight: 0, // swiper 高度（px），按屏幕动态计算
    isAdmin: false,
    // 群总览分享（管理员）
    shareGroupText: '',
    shareGroupLoading: false,
    showShareGroupModal: false,
  },

  onShareAppMessage() {
    return {
      title: this.data.shareGroupText || 'WeRun 跑步群周榜，一起来运动！',
      path: '/pages/ranking/ranking',
    };
  },

  onLoad() {
    // 计算 swiper 可用高度：屏幕高度 - 顶部标签栏(约 88rpx)
    try {
      const info = wx.getSystemInfoSync();
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
    this.setData({ isAdmin: !!(user && user.isAdmin), loggedIn: !!user, isPending });
    if (user && !isPending) {
      this.load();
    } else {
      this.setData({ loading: false, boards: [] });
    }
  },

  // 未登录时点击登录，仅在用户主动选择时才发起微信登录
  async goLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      await api.login();
      app.fetchConfig();
      const user = app.globalData.user;
      this.setData({ loggedIn: !!user, isAdmin: !!(user && user.isAdmin) });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loggingIn: false });
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
      total: b.list.length,
      top3,
      rest,
      page: p,
      totalPages,
      visibleRest,
    };
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

  // ── 群总览分享（管理员）────────────────────────────────
  async openGroupShareModal() {
    if (this.data.shareGroupLoading) return;
    this.setData({ shareGroupLoading: true });
    try {
      const data = await api.request('/api/share/group');
      this.setData({ shareGroupText: data.text, showShareGroupModal: true });
    } catch (e) {
      wx.showToast({ title: e.message || '生成文案失败', icon: 'none' });
    } finally {
      this.setData({ shareGroupLoading: false });
    }
  },

  closeGroupShareModal() {
    this.setData({ showShareGroupModal: false });
  },

  copyGroupShareText() {
    wx.setClipboardData({
      data: this.data.shareGroupText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },
});

const api = require('../../utils/api');
const app = getApp();

// epoch 毫秒 → "2026-03-03 18:03:19"（设备本地时区）
function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

Page({
  data: {
    // 标签页：'members' | 'logs'
    activeTab: 'members',

    // ── 成员管理 ──
    list: [],
    loading: true,
    myOpenid: '',

    // 改名弹窗
    renameModal: false,
    renameTarget: null,
    newNickname: '',
    renaming: false,

    // Excel 导入（整套导入功能由服务端 SHOW_IMPORT 开关控制，默认隐藏）
    showImport: false,
    importLoading: false,
    showImportResult: false,
    importResult: null,

    // 滚动公告
    noticeText: '',
    savingNotice: false,

    // 待审核申请
    applications: [],
    approvingOpenid: '',

    // 待匹配导入记录
    pendingImports: [],
    matchModal: false,
    matchTarget: null, // { nickname, count }

    // ── 打卡日志 ──
    logs: [],
    logsLoading: false,
    logsPage: 1,
    logsTotal: 0,
    logsPageSize: 20,
    logsHasMore: false,
  },

  onShow() {
    const user = app.globalData.user;
    if (!user || !user.isAdmin) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const showImport = !!app.globalData.remoteConfig.showImport;
    this.setData({
      myOpenid: user.openid,
      showImport,
      noticeText: app.globalData.remoteConfig.noticeText || '',
    });
    this.load();
    this.loadApplications();
    if (showImport) this.loadPendingImports();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'logs' && this.data.logs.length === 0) {
      this.loadLogs(1);
    }
  },

  // ── 滚动公告 ──────────────────────────────────────────────
  onNoticeInput(e) {
    this.setData({ noticeText: e.detail.value });
  },

  async saveNotice() {
    if (this.data.savingNotice) return;
    const text = (this.data.noticeText || '').trim();
    this.setData({ savingNotice: true });
    try {
      const data = await api.request('/api/admin/notice', { method: 'POST', data: { text } });
      // 同步全局配置，首页 onShow 即读到最新公告
      app.globalData.remoteConfig.noticeText = data.text;
      this.setData({ noticeText: data.text });
      wx.showToast({ title: text ? '公告已更新' : '公告已撤下', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingNotice: false });
    }
  },

  // ── 待审核申请 ────────────────────────────────────────────
  async loadApplications() {
    try {
      const data = await api.request('/api/admin/applications');
      this.setData({ applications: data.list });
    } catch (e) {
      // 静默
    }
  },

  approveUser(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    wx.showModal({
      title: '通过申请',
      content: `确定通过「${nickname || '该用户'}」的加入申请吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          this.setData({ approvingOpenid: openid });
          await api.request(`/api/admin/users/${openid}/approve`, { method: 'POST' });
          wx.showToast({ title: '已通过申请', icon: 'success' });
          this.loadApplications();
          this.load();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        } finally {
          this.setData({ approvingOpenid: '' });
        }
      },
    });
  },

  rejectUser(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    wx.showModal({
      title: '拒绝申请',
      content: `确定拒绝「${nickname || '该用户'}」的加入申请吗？其账号将被删除。`,
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request(`/api/admin/users/${openid}/kick`, { method: 'POST' });
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.loadApplications();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  // ── 成员管理 ──────────────────────────────────────────────
  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.request('/api/admin/users');
      this.setData({ list: data.list });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  kick(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    wx.showModal({
      title: '踢出成员',
      content: `确定踢出「${nickname}」吗？其打卡记录将一并删除。`,
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request(`/api/admin/users/${openid}/kick`, { method: 'POST' });
          wx.showToast({ title: '已踢出', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  toggleAdmin(e) {
    const { openid, nickname, isadmin } = e.currentTarget.dataset;
    const makeAdmin = !isadmin;
    wx.showModal({
      title: makeAdmin ? '设为管理员' : '取消管理员',
      content: `确定${makeAdmin ? '授予' : '取消'}「${nickname}」管理员权限吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request(`/api/admin/users/${openid}/admin`, {
            method: 'POST',
            data: { isAdmin: makeAdmin },
          });
          wx.showToast({ title: '已更新', icon: 'success' });
          this.load();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  // 订阅新成员申请通知（管理员每次点击刷新一次订阅额度）
  subscribeApplyNotify() {
    const tmplId = app.globalData.remoteConfig.applyTemplateId;
    if (!tmplId) {
      wx.showToast({ title: '服务端未配置通知模板', icon: 'none' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (res[tmplId] === 'accept') {
          wx.showToast({ title: '已订阅申请通知', icon: 'success' });
        } else {
          wx.showToast({ title: '未授权，可稍后重试', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '订阅失败', icon: 'none' }),
    });
  },

  deleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '将永久删除当前账号及所有打卡记录，无法恢复。确认注销？',
      confirmText: '确认注销',
      confirmColor: '#fa5151',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        // 二次确认
        wx.showModal({
          title: '再次确认',
          content: '注销后需重新登录，历史数据将全部清空。',
          confirmText: '注销',
          confirmColor: '#fa5151',
          cancelText: '取消',
          success: async (res2) => {
            if (!res2.confirm) return;
            try {
              await api.request('/api/account/delete', { method: 'POST' });
              getApp().clearAuth();
              wx.reLaunch({ url: '/pages/index/index' });
            } catch (e) {
              wx.showToast({ title: e.message || '注销失败', icon: 'none' });
            }
          },
        });
      },
    });
  },

  copyOpenid(e) {
    const openid = e.currentTarget.dataset.openid;
    wx.setClipboardData({ data: openid, success: () => wx.showToast({ title: '已复制', icon: 'success' }) });
  },

  // ── 改名 ──────────────────────────────────────────────────
  openRenameModal(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    this.setData({
      renameModal: true,
      renameTarget: { openid, nickname },
      newNickname: nickname || '',
    });
  },

  closeRenameModal() {
    this.setData({ renameModal: false, renameTarget: null, newNickname: '' });
  },

  onNewNicknameInput(e) {
    this.setData({ newNickname: e.detail.value });
  },

  async confirmRename() {
    if (this.data.renaming) return;
    const name = this.data.newNickname.trim();
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    this.setData({ renaming: true });
    try {
      await api.request(`/api/admin/users/${this.data.renameTarget.openid}/nickname`, {
        method: 'POST',
        data: { nickname: name },
      });
      wx.showToast({ title: '已修改', icon: 'success' });
      this.closeRenameModal();
      this.load();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ renaming: false });
    }
  },

  // ── Excel 导入 ────────────────────────────────────────────
  importExcel() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: async (res) => {
        const file = res.tempFiles[0];
        this.setData({ importLoading: true });
        try {
          const result = await api.upload('/api/admin/import', file.path, { name: 'excel' });
          this.setData({ importResult: result, showImportResult: true });
          this.load();
          this.loadPendingImports();
        } catch (e) {
          wx.showToast({ title: e.message || '导入失败', icon: 'none' });
        } finally {
          this.setData({ importLoading: false });
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '请先将 Excel 发送到微信聊天，再从文件中选择', icon: 'none', duration: 3000 });
      },
    });
  },

  closeImportResult() {
    this.setData({ showImportResult: false, importResult: null });
  },

  // ── 待匹配导入记录 ─────────────────────────────────────────
  async loadPendingImports() {
    try {
      const data = await api.request('/api/admin/import/pending');
      this.setData({ pendingImports: data.list });
    } catch (e) {
      // 静默
    }
  },

  openMatchModal(e) {
    const { nickname, count } = e.currentTarget.dataset;
    this.setData({ matchModal: true, matchTarget: { nickname, count } });
  },

  closeMatchModal() {
    this.setData({ matchModal: false, matchTarget: null });
  },

  pickMatchUser(e) {
    const { openid, nickname: userNickname } = e.currentTarget.dataset;
    const { nickname: importNickname, count } = this.data.matchTarget;
    wx.showModal({
      title: '确认匹配',
      content: `将「${importNickname}」的 ${count} 条导入记录关联到「${userNickname}」？`,
      success: (res) => {
        if (!res.confirm) return;
        this._doMatch(importNickname, openid);
      },
    });
  },

  async _doMatch(nickname, openid) {
    try {
      const result = await api.request('/api/admin/import/match', {
        method: 'POST',
        data: { nickname, openid },
      });
      wx.showToast({ title: `已匹配 ${result.inserted} 条`, icon: 'success' });
      this.closeMatchModal();
      this.loadPendingImports();
      this.load();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  discardPending(e) {
    const { nickname, count } = e.currentTarget.dataset;
    wx.showModal({
      title: '丢弃记录',
      content: `确定丢弃「${nickname}」的 ${count} 条待匹配记录吗？此操作不可恢复。`,
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.request('/api/admin/import/discard', { method: 'POST', data: { nickname } });
          wx.showToast({ title: '已丢弃', icon: 'success' });
          this.loadPendingImports();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  // ── 打卡日志 ──────────────────────────────────────────────
  async loadLogs(page) {
    if (this.data.logsLoading) return;
    this.setData({ logsLoading: true });
    try {
      const data = await api.request(
        `/api/admin/checkins?page=${page}&pageSize=${this.data.logsPageSize}`
      );
      // 提交时间精确到时分秒；来源只有日期的（如 Excel 导入）时分秒为 00:00:00
      const list = data.list.map((item) => ({
        ...item,
        createdAtText: formatDateTime(item.createdAt),
      }));
      const logs = page === 1 ? list : [...this.data.logs, ...list];
      this.setData({
        logs,
        logsPage: page,
        logsTotal: data.total,
        logsHasMore: logs.length < data.total,
      });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ logsLoading: false });
    }
  },

  loadMoreLogs() {
    if (!this.data.logsHasMore || this.data.logsLoading) return;
    this.loadLogs(this.data.logsPage + 1);
  },

  refreshLogs() {
    this.loadLogs(1);
  },
});

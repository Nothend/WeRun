const api = require('../../utils/api');
const config = require('../../config');
const app = getApp();

Page({
  data: {
    // 标签页：'members' | 'logs'
    activeTab: 'members',

    // ── 成员管理 ──
    list: [],
    loading: true,
    myOpenid: '',
    myNotifyCheckin: false,
    togglingNotify: false,

    // 改名弹窗
    renameModal: false,
    renameTarget: null,
    newNickname: '',
    renaming: false,

    // Excel 导入
    importLoading: false,
    showImportResult: false,
    importResult: null,

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
    this.setData({ myOpenid: user.openid });
    this.load();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'logs' && this.data.logs.length === 0) {
      this.loadLogs(1);
    }
  },

  // ── 成员管理 ──────────────────────────────────────────────
  async load() {
    this.setData({ loading: true });
    try {
      const data = await api.request('/api/admin/users');
      const me = data.list.find((u) => u.openid === this.data.myOpenid);
      this.setData({
        list: data.list,
        myNotifyCheckin: me ? !!me.notifyCheckin : false,
      });
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

  // ── 打卡通知开关 ──────────────────────────────────────────
  async toggleNotify() {
    if (this.data.togglingNotify) return;
    const newNotify = !this.data.myNotifyCheckin;

    // 开启通知时先请求订阅授权
    if (newNotify && config.notifyTemplateId) {
      wx.requestSubscribeMessage({
        tmplIds: [config.notifyTemplateId],
        complete: () => { this._saveNotifySetting(newNotify); },
      });
    } else {
      this._saveNotifySetting(newNotify);
    }
  },

  async _saveNotifySetting(notify) {
    this.setData({ togglingNotify: true });
    try {
      await api.request('/api/admin/notify-setting', {
        method: 'POST',
        data: { notify },
      });
      this.setData({ myNotifyCheckin: notify });
      wx.showToast({ title: notify ? '已开启通知' : '已关闭通知', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ togglingNotify: false });
    }
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

  // ── 打卡日志 ──────────────────────────────────────────────
  async loadLogs(page) {
    if (this.data.logsLoading) return;
    this.setData({ logsLoading: true });
    try {
      const data = await api.request(
        `/api/admin/checkins?page=${page}&pageSize=${this.data.logsPageSize}`
      );
      const logs = page === 1 ? data.list : [...this.data.logs, ...data.list];
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

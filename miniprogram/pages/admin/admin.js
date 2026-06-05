const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    list: [],
    loading: true,
    myOpenid: '',
    // 改名弹窗
    renameModal: false,
    renameTarget: null,
    newNickname: '',
    renaming: false,
    // Excel 导入
    importLoading: false,
    showImportResult: false,
    importResult: null,
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

  // ── 改名 ──────────────────────────────────────────────
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

  // ── Excel 导入 ────────────────────────────────────────
  importExcel() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ importLoading: true });
        wx.uploadFile({
          url: require('../../config').baseUrl + '/api/admin/import',
          filePath: file.path,
          name: 'excel',
          header: {
            Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : '',
          },
          success: (uploadRes) => {
            let result;
            try { result = JSON.parse(uploadRes.data); } catch (e) {
              wx.showToast({ title: '返回数据解析失败', icon: 'none' });
              return;
            }
            if (uploadRes.statusCode >= 200 && uploadRes.statusCode < 300) {
              this.setData({ importResult: result, showImportResult: true });
              this.load();
            } else {
              wx.showToast({ title: result.error || '导入失败', icon: 'none' });
            }
          },
          fail: () => wx.showToast({ title: '上传失败', icon: 'none' }),
          complete: () => this.setData({ importLoading: false }),
        });
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
});

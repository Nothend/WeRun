const api = require('../../utils/api');
const app = getApp();

Page({
  data: {
    list: [],
    loading: true,
    myOpenid: '',
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
});

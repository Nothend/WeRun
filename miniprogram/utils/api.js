const config = require('../config');

function getApp_() {
  return getApp();
}

// 401 统一处理：清登录态；若不在首页则带回首页，避免页面停留在残留数据上
function handleUnauthorized(app) {
  app.clearAuth();
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current && current.route !== 'pages/index/index') {
    wx.reLaunch({ url: '/pages/index/index' });
  }
}

// 统一 wx.request 封装：自动加 baseUrl + token，401 时清登录态
function request(path, { method = 'GET', data } = {}) {
  const app = getApp_();
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl + path,
      method,
      data,
      header: {
        'content-type': 'application/json',
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : '',
      },
      success(res) {
        if (res.statusCode === 401) {
          handleUnauthorized(app);
          reject(new Error(res.data && res.data.error ? res.data.error : '登录已失效'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

// 文件上传封装（打卡截图 / 头像）
function upload(path, filePath, { name = 'file', formData = {} } = {}) {
  const app = getApp_();
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: config.baseUrl + path,
      filePath,
      name,
      formData,
      header: {
        Authorization: app.globalData.token ? `Bearer ${app.globalData.token}` : '',
      },
      success(res) {
        let data = {};
        try {
          data = JSON.parse(res.data);
        } catch (e) {
          reject(new Error('返回数据解析失败'));
          return;
        }
        if (res.statusCode === 401) {
          handleUnauthorized(app);
          reject(new Error(data.error || '登录已失效'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || `上传失败(${res.statusCode})`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

// 微信登录：wx.login → 后端 /api/login
function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          reject(new Error('微信登录失败：未拿到 code'));
          return;
        }
        request('/api/login', { method: 'POST', data: { code: res.code } })
          .then((data) => {
            getApp_().setAuth(data.token, data.user);
            resolve(data);
          })
          .catch(reject);
      },
      fail(err) {
        reject(new Error(err.errMsg || '微信登录失败'));
      },
    });
  });
}

module.exports = { request, upload, login };

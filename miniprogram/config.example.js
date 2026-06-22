// 发布前需手动修改 baseUrl，与 server/.env 的 PUBLIC_BASE_URL 保持一致。
// 订阅消息模板ID 不在这里配置——小程序启动时从 /api/config 动态获取，存于 app.globalData.remoteConfig。
module.exports = {
  baseUrl: 'https://your.domain.com',
  // 仅本地联调用：设成某个 openid（如 'mock_admin'）可固定以该身份登录，不受 wx.login 每次 code 变化影响。
  // 正式发布务必置空 ''（服务端非 mock 模式也会忽略此字段）。
  devLoginAs: '',
};

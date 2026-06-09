// 发布前需手动修改 baseUrl，与 server/.env 的 PUBLIC_BASE_URL 保持一致。
// 订阅消息模板ID 不在这里配置——小程序启动时从 /api/config 动态获取，存于 app.globalData.remoteConfig。
module.exports = {
  baseUrl: 'https://your.domain.com',
  notifyTemplateId: '', // 旧打卡通知模板（可留空，已由新模板替代）
};

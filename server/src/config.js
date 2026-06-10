const path = require('path');
require('dotenv').config();

// 数据目录：容器内固定为 /app/data（compose 挂载卷），本地默认 server/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  appid: process.env.APPID || '',
  appsecret: process.env.APPSECRET || '',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  qwenModel: process.env.QWEN_MODEL || 'qwen-vl-max',
  qwenBaseUrl: (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'dev_insecure_secret_change_me',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  bootstrapAdminOpenid: process.env.BOOTSTRAP_ADMIN_OPENID || '',
  minDurationMinutes: parseFloat(process.env.MIN_DURATION_MINUTES || '30'),
  weeklyTarget: parseInt(process.env.WEEKLY_TARGET || '3', 10),
  // 感知哈希(dHash, 256bit)相似度日志阈值：汉明距离 <= 此值时记录"疑似相似截图"日志（不拦截）
  // 用于积累真实样本，评估是否启用拦截及合适阈值
  imageSimilarityLogThreshold: parseInt(process.env.IMAGE_SIMILARITY_LOG_THRESHOLD || '20', 10),
  wechatNotifyTemplateId: process.env.WECHAT_NOTIFY_TEMPLATE_ID || '',
  // 订阅消息模板A：有新用户申请时通知管理员
  applyTemplateId: process.env.APPLY_TEMPLATE_ID || '',
  // 订阅消息模板B：每周日统计推送给成员
  weeklyTemplateId: process.env.WEEKLY_TEMPLATE_ID || '',

  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'app.db'),
  avatarDir: path.join(DATA_DIR, 'avatars'),

  // 没有真实 APPID 时进入 mock 模式：跳过真实 code2session，便于本地/未配置时联调
  get useMockWechat() {
    return !this.appid || this.appid.startsWith('wx_example');
  },
  // 没有真实千问 Key 时进入 mock 模式：随机/固定返回一个时长，便于联调
  get useMockQwen() {
    return !this.dashscopeApiKey || this.dashscopeApiKey.startsWith('sk-example');
  },
};

module.exports = config;

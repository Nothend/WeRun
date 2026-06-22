const path = require('path');
require('dotenv').config();

// 数据目录：容器内固定为 /app/data（compose 挂载卷），本地默认 server/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// 赞助用户名单（逗号分隔）。这些用户在排行榜/今日动态/个人主页享有「尊贵」展示样式。
// 每项可选地用「:徽标」给该用户自定义徽标，例：oAAA,oBBB:🍒,oCCC:🎀
// ——未写徽标的沿用 SPONSOR_BADGE 默认值（仅 oAAA 这种）。openid 不含冒号，故取第一个冒号分隔。
const defaultSponsorBadge = process.env.SPONSOR_BADGE != null ? process.env.SPONSOR_BADGE : '💎';
const sponsorBadges = new Map(); // openid -> 该用户徽标文案（空串=不展示徽标但仍享金环+渐变）
(process.env.SPONSOR_OPENIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .forEach((entry) => {
    const idx = entry.indexOf(':');
    if (idx === -1) sponsorBadges.set(entry, defaultSponsorBadge);
    else sponsorBadges.set(entry.slice(0, idx).trim(), entry.slice(idx + 1).trim());
  });

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
  // 截图运动日期允许的最大滞后天数：0=只允许今天，1=允许今天或昨天（默认，
  // 照顾"晚上跑完次日早上打卡"）。识别不出日期或超出范围的截图会被拒绝
  screenshotMaxLagDays: parseInt(process.env.SCREENSHOT_MAX_LAG_DAYS || '1', 10),
  // 是否对打卡截图调用微信内容安全检测(imgSecCheck)。true(默认)=送检，平台合规要求；
  // false=跳过检测，打卡更快但有合规风险。改这个值后必须重建容器(docker compose up -d)才生效。
  screenshotSecCheck: process.env.SCREENSHOT_SEC_CHECK !== 'false',
  // 「关于作者」页是否显示运营成本说明与赞赏码。默认隐藏——平台不允许个人
  // 主体小程序出现赞赏内容，提审时务必保持 false
  showSupport: process.env.SHOW_SUPPORT === 'true',
  // 后台「成员管理」是否显示 Excel 历史数据导入功能（导入按钮+格式说明+待匹配记录）。
  // 默认隐藏——导入仅用于一次性历史数据迁移，迁移完成后用不上，平时隐藏保持后台简洁；
  // 需要导入时把 SHOW_IMPORT=true 重启即可
  showImport: process.env.SHOW_IMPORT === 'true',
  // 感知哈希(dHash, 256bit)相似度日志阈值：汉明距离 <= 此值时记录"疑似相似截图"日志（不拦截）
  // 用于积累真实样本，评估是否启用拦截及合适阈值
  imageSimilarityLogThreshold: parseInt(process.env.IMAGE_SIMILARITY_LOG_THRESHOLD || '20', 10),
  // 感知哈希(dHash)相似度拦截阈值：仅在"识别不到秒级时长"（无法用秒级指纹去重）时生效，
  // 汉明距离 <= 此值时拒绝打卡。比日志阈值更严格，默认5，可据日志中的真实距离分布微调
  imageSimilarityBlockThreshold: parseInt(process.env.IMAGE_SIMILARITY_BLOCK_THRESHOLD || '5', 10),
  // 会员审核开关：true=用户提交申请后自动通过、立即成为正式成员；
  // false（默认）=申请进入待审核，需管理员在后台手动通过
  autoApproveMembers: process.env.AUTO_APPROVE_MEMBERS === 'true',
  // 订阅消息模板A：有新用户申请时通知管理员。默认填本小程序在微信后台申请到的模板，
  // 未显式配置环境变量时也能正常推送；换小程序/换模板时用 APPLY_TEMPLATE_ID 覆盖
  applyTemplateId: process.env.APPLY_TEMPLATE_ID || 'fo2Y9PPFnbrq7s2jPXh3L-jPKYq5Pg0N7SUgjYbp20w',
  // 订阅消息模板B：每周日统计推送给成员。同样内置本小程序的默认模板，
  // 未显式配置环境变量时也能正常推送；换小程序/换模板时用 WEEKLY_TEMPLATE_ID 覆盖
  weeklyTemplateId: process.env.WEEKLY_TEMPLATE_ID || '-7VQUbJgN8n-tnv8OPb7VKpfhdSFXMBAHVvkxCIaD-k',

  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'app.db'),
  avatarDir: path.join(DATA_DIR, 'avatars'),
  reportDir: path.join(DATA_DIR, 'reports'),
  // 自定义千问识别提示词模板（可选）：放在 data 卷里，改完即生效，无需发版/重启。
  // 模板中用 {{TODAY}} 占位今天的北京日期；文件不存在时使用代码内置的默认提示词
  qwenPromptPath: path.join(DATA_DIR, 'qwen-prompt.txt'),

  // 赞助用户判定：openid 是否在 SPONSOR_OPENIDS 名单内（享受「尊贵」展示）
  isSponsor(openid) {
    return !!openid && sponsorBadges.has(openid);
  },
  // 该用户专属徽标文案：自定义了就用自定义的，否则用 SPONSOR_BADGE 默认值；
  // 非赞助用户或徽标设为空串时返回空串（前端据此隐藏徽标，金环+渐变仍保留）。
  // 随每个用户对象下发到前端，改完重启容器即生效，无需重新提审小程序。
  sponsorBadgeFor(openid) {
    return (openid && sponsorBadges.get(openid)) || '';
  },

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

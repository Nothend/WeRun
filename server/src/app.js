const express = require('express');
const path = require('path');
const cron = require('node-cron');
const config = require('./config');
const db = require('./db'); // 初始化数据库与目录
const { sendSubscribeMessage } = require('./wechat');
const { currentWeekKey } = require('./week');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态托管头像：GET /avatars/<openid>.png
app.use('/avatars', express.static(config.avatarDir, { maxAge: '7d' }));
// 静态公共资源：GET /public/<file>
app.use('/public', express.static(path.join(__dirname, '..', 'public'), { maxAge: '30d' }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mockWechat: config.useMockWechat,
    mockQwen: config.useMockQwen,
    time: Date.now(),
  });
});

// 业务路由
app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/login'));
app.use('/api', require('./routes/apply'));
app.use('/api', require('./routes/profile'));
app.use('/api', require('./routes/checkin'));
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/account'));
app.use('/api', require('./routes/share'));

// 404
app.use((req, res) => res.status(404).json({ error: 'not found' }));

// ── 每周日 22:00 发送本周打卡周报（模板B）──────────────────────────
async function sendWeeklyReport() {
  const weekKey = currentWeekKey();
  console.log(`[weekly-notify] ${new Date().toISOString()} weekKey=${weekKey} 开始发送周报`);

  const members = db.prepare("SELECT * FROM users WHERE status = 'active'").all();
  let totalAchieved = 0;
  let groupMinutes = 0;

  // 每人发送个人周报
  for (const member of members) {
    const stats = db
      .prepare(
        'SELECT COUNT(*) AS n, COALESCE(SUM(duration_minutes), 0) AS total FROM checkins WHERE openid = ? AND week_key = ?'
      )
      .get(member.openid, weekKey);
    const count = stats.n || 0;
    const minutes = Math.round(stats.total || 0);
    const achieved = count >= config.weeklyTarget;
    if (achieved) totalAchieved++;
    groupMinutes += minutes;

    if (!config.weeklyTemplateId) continue;
    const hint = achieved
      ? '坚持运动，你很棒！'
      : `还差 ${config.weeklyTarget - count} 次，下周继续！`;
    sendSubscribeMessage(
      member.openid,
      config.weeklyTemplateId,
      {
        thing7:  { value: 'WeRun 本周运动打卡' },
        phrase4: { value: achieved ? '已达标' : '未达标' },
        thing5:  { value: hint },
        thing1:  { value: `每周完成 ${config.weeklyTarget} 次打卡` },
        thing2:  { value: `本周共 ${minutes} 分钟` },
      },
      'pages/index/index'
    ).catch((e) => console.warn(`[weekly-notify] personal ${member.openid}: ${e.message}`));
  }

  // 对管理员额外发一条全员汇总
  if (config.weeklyTemplateId) {
    const admins = members.filter((m) => m.is_admin);
    for (const admin of admins) {
      sendSubscribeMessage(
        admin.openid,
        config.weeklyTemplateId,
        {
          thing7:  { value: 'WeRun 本周汇总' },
          phrase4: { value: '已完成' },
          thing5:  { value: `${totalAchieved}/${members.length} 人达标` },
          thing1:  { value: `达标标准 ${config.weeklyTarget} 次/周` },
          thing2:  { value: `全员共 ${groupMinutes} 分钟` },
        },
        'pages/ranking/ranking'
      ).catch((e) => console.warn(`[weekly-notify] summary ${admin.openid}: ${e.message}`));
    }
  }

  console.log(
    `[weekly-notify] 完成：total=${members.length} achieved=${totalAchieved} minutes=${groupMinutes}`
  );
}

// 每周日 22:00（中国时区）发送周报
cron.schedule('0 22 * * 0', sendWeeklyReport, { timezone: 'Asia/Shanghai' });

app.listen(config.port, () => {
  console.log(`[WeRun] server listening on :${config.port}`);
  if (config.useMockWechat) console.log('[WeRun] ⚠️  微信处于 mock 模式（未配置真实 APPID/APPSECRET）');
  if (config.useMockQwen) console.log('[WeRun] ⚠️  千问处于 mock 模式（未配置真实 DASHSCOPE_API_KEY）');
});

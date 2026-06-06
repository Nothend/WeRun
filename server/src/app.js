const express = require('express');
const path = require('path');
const config = require('./config');
require('./db'); // 初始化数据库与目录

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态托管头像：GET /avatars/<openid>.png
app.use('/avatars', express.static(config.avatarDir, { maxAge: '7d' }));

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
app.use('/api', require('./routes/profile'));
app.use('/api', require('./routes/checkin'));
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/account'));
app.use('/api', require('./routes/share'));

// 404
app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.listen(config.port, () => {
  console.log(`[WeRun] server listening on :${config.port}`);
  if (config.useMockWechat) console.log('[WeRun] ⚠️  微信处于 mock 模式（未配置真实 APPID/APPSECRET）');
  if (config.useMockQwen) console.log('[WeRun] ⚠️  千问处于 mock 模式（未配置真实 DASHSCOPE_API_KEY）');
});

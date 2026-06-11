const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/me  返回当前用户最新信息（待审核用户用它刷新审核结果）
router.get('/me', authRequired, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      openid: user.openid,
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
      isAdmin: !!user.is_admin,
      status: user.status || 'active',
      hasApplied: !!user.applied_at,
    },
  });
});

// POST /api/profile
//   JSON:      { nickname, avatarUrl? }  avatarUrl 为微信 CDN https URL
//   multipart: nickname(字段) + avatar(file, 可选)
router.post('/profile', authRequired, upload.single('avatar'), (req, res) => {
  try {
    const openid = req.user.openid;
    const nickname = (req.body.nickname || '').toString().slice(0, 30);

    let avatarUrl = req.user.avatar_url;
    if (req.file) {
      // 文件上传：存为 <openid>.png
      const filename = `${openid}.png`;
      fs.writeFileSync(path.join(config.avatarDir, filename), req.file.buffer);
      avatarUrl = `${config.publicBaseUrl}/avatars/${filename}`;
    } else if (req.body.avatarUrl && req.body.avatarUrl.startsWith('https://')) {
      // 直接使用微信 CDN URL，无需本地存储
      avatarUrl = req.body.avatarUrl;
    }

    db.prepare('UPDATE users SET nickname = ?, avatar_url = ? WHERE openid = ?').run(
      nickname || req.user.nickname,
      avatarUrl,
      openid
    );

    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    res.json({
      user: {
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        isAdmin: !!user.is_admin,
        status: user.status || 'active',
        hasApplied: !!user.applied_at,
      },
    });
  } catch (e) {
    console.error('profile error:', e);
    res.status(500).json({ error: e.message || '保存资料失败' });
  }
});

module.exports = router;

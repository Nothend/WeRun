const express = require('express');
const db = require('../db');
const config = require('../config');
const { code2session } = require('../wechat');
const { signToken } = require('../auth');

const router = express.Router();

// POST /api/login  { code }
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: '缺少 code' });

    const { openid } = await code2session(code);

    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      // 决定是否为首个管理员：env 指定，或库中还没有任何管理员
      const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
      const isFirstAdmin =
        (config.bootstrapAdminOpenid && config.bootstrapAdminOpenid === openid) ||
        (!config.bootstrapAdminOpenid && adminCount === 0);

      const defaultNickname = '跑友' + openid.slice(-4);
      const newStatus = isFirstAdmin ? 'active' : 'pending';
      db.prepare(
        'INSERT INTO users (openid, nickname, avatar_url, is_admin, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(openid, defaultNickname, '', isFirstAdmin ? 1 : 0, newStatus, Date.now());
      user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    }

    const token = signToken(openid);
    res.json({
      token,
      isNewUser,
      user: {
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        isAdmin: !!user.is_admin,
        status: user.status || 'active',
        hasApplied: !!user.applied_at,
        isSponsor: config.isSponsor(user.openid),
        sponsorBadge: config.sponsorBadgeFor(user.openid),
      },
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: e.message || '登录失败' });
  }
});

module.exports = router;

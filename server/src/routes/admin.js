const express = require('express');
const db = require('../db');
const { authRequired, adminRequired } = require('../auth');

const router = express.Router();

// 所有 /api/admin/* 都需要登录 + 管理员
router.use(authRequired, adminRequired);

// GET /api/admin/users  用户列表（含本周次数）
router.get('/admin/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, u.is_admin AS isAdmin,
              u.created_at AS createdAt,
              (SELECT COUNT(*) FROM checkins c WHERE c.openid = u.openid) AS totalCheckins
         FROM users u
        ORDER BY u.is_admin DESC, u.created_at ASC`
    )
    .all();
  res.json({
    list: rows.map((r) => ({
      openid: r.openid,
      nickname: r.nickname || '未设置昵称',
      avatarUrl: r.avatarUrl || '',
      isAdmin: !!r.isAdmin,
      totalCheckins: r.totalCheckins,
      createdAt: r.createdAt,
    })),
  });
});

// POST /api/admin/users/:openid/kick  踢出用户（删用户 + 其打卡记录）
router.post('/admin/users/:openid/kick', (req, res) => {
  const target = req.params.openid;
  if (target === req.user.openid) {
    return res.status(400).json({ error: '不能踢出自己' });
  }
  const tx = db.transaction((openid) => {
    db.prepare('DELETE FROM checkins WHERE openid = ?').run(openid);
    const info = db.prepare('DELETE FROM users WHERE openid = ?').run(openid);
    return info.changes;
  });
  const changes = tx(target);
  if (!changes) return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true });
});

// POST /api/admin/users/:openid/admin  { isAdmin: true|false } 授予/取消管理员
router.post('/admin/users/:openid/admin', (req, res) => {
  const target = req.params.openid;
  const isAdmin = req.body && req.body.isAdmin ? 1 : 0;

  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(target);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 防止取消最后一个管理员
  if (!isAdmin) {
    const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
    if (adminCount <= 1 && user.is_admin) {
      return res.status(400).json({ error: '至少保留一名管理员' });
    }
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE openid = ?').run(isAdmin, target);
  res.json({ ok: true, isAdmin: !!isAdmin });
});

module.exports = router;

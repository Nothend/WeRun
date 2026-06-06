const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// POST /api/account/delete  永久删除当前登录用户及其所有打卡记录
router.post('/account/delete', authRequired, (req, res) => {
  const openid = req.user.openid;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM checkins WHERE openid = ?').run(openid);
    db.prepare('DELETE FROM users WHERE openid = ?').run(openid);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;

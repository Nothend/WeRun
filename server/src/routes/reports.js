const express = require('express');
const { authRequired, activeRequired } = require('../auth');
const { listUnreadFor, markRead } = require('../reportmsg');

const router = express.Router();

// GET /api/reports  当前用户的未读战报消息（年>月>周）
router.get('/reports', authRequired, activeRequired, (req, res) => {
  const items = listUnreadFor(req.user);
  res.json({ items, unreadCount: items.length });
});

// POST /api/reports/read { key }  标记某条战报已读
router.post('/reports/read', authRequired, activeRequired, (req, res) => {
  const key = (req.body && req.body.key) || '';
  if (!key) return res.status(400).json({ error: '缺少 key' });
  markRead(req.user.openid, key);
  res.json({ ok: true });
});

module.exports = router;

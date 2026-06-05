const express = require('express');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../auth');
const { currentWeekKey } = require('../week');

const router = express.Router();

// GET /api/stats/me  我的本周状态
router.get('/stats/me', authRequired, (req, res) => {
  const weekKey = currentWeekKey();
  const weekCount = db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
    .get(req.user.openid, weekKey).n;
  res.json({
    weekKey,
    weekCount,
    target: config.weeklyTarget,
    achieved: weekCount >= config.weeklyTarget,
  });
});

// GET /api/stats/group  群周榜（本周）
router.get('/stats/group', authRequired, (req, res) => {
  const weekKey = currentWeekKey();
  const rows = db
    .prepare(
      `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl,
              COUNT(c.id) AS weekCount
         FROM users u
         LEFT JOIN checkins c ON c.openid = u.openid AND c.week_key = ?
        GROUP BY u.openid
        ORDER BY weekCount DESC, u.created_at ASC`
    )
    .all(weekKey);

  const list = rows.map((r) => ({
    openid: r.openid,
    nickname: r.nickname || '未设置昵称',
    avatarUrl: r.avatarUrl || '',
    weekCount: r.weekCount,
    achieved: r.weekCount >= config.weeklyTarget,
  }));

  res.json({
    weekKey,
    target: config.weeklyTarget,
    achievedCount: list.filter((x) => x.achieved).length,
    total: list.length,
    list,
  });
});

module.exports = router;

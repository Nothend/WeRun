const express = require('express');
const db = require('../db');
const { authRequired, adminRequired } = require('../auth');
const { currentWeekKey } = require('../week');
const config = require('../config');
const { generateShareText, generateGroupShareText } = require('../qwen');

const router = express.Router();

// GET /api/share/me  AI 生成个人打卡分享文案
router.get('/share/me', authRequired, async (req, res) => {
  try {
    const weekKey = currentWeekKey();
    const weekCount = db
      .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
      .get(req.user.openid, weekKey).n;
    const totalCount = db
      .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ?')
      .get(req.user.openid).n;
    const user = db.prepare('SELECT nickname FROM users WHERE openid = ?').get(req.user.openid);

    const text = await generateShareText({
      nickname: (user && user.nickname) || '跑者',
      weekCount,
      weekTarget: config.weeklyTarget,
      totalCount,
      achieved: weekCount >= config.weeklyTarget,
    });

    res.json({ text, weekCount, totalCount, achieved: weekCount >= config.weeklyTarget });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/share/group  AI 生成群周报分享文案（仅管理员）
router.get('/share/group', authRequired, adminRequired, async (req, res) => {
  try {
    const weekKey = currentWeekKey();
    const rows = db
      .prepare(
        `SELECT u.nickname, COUNT(c.id) AS weekCount
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid AND c.week_key = ?
          GROUP BY u.openid
          ORDER BY weekCount DESC`
      )
      .all(weekKey);

    const achievedCount = rows.filter((r) => r.weekCount >= config.weeklyTarget).length;
    const topRunners = rows
      .slice(0, 3)
      .map((r) => r.nickname || '匿名跑者');

    const text = await generateGroupShareText({
      weekKey,
      achievedCount,
      total: rows.length,
      target: config.weeklyTarget,
      topRunners,
    });

    res.json({ text, achievedCount, total: rows.length, weekKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

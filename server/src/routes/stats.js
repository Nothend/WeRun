const express = require('express');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../auth');
const {
  currentWeekKey,
  lastWeekKey,
  currentMonthStr,
  lastMonthStr,
  currentYearStr,
  localDateStr,
} = require('../week');

const router = express.Router();

// GET /api/stats/me  我的本周状态
router.get('/stats/me', authRequired, (req, res) => {
  const weekKey = currentWeekKey();
  const today = localDateStr();
  const weekCount = db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
    .get(req.user.openid, weekKey).n;
  const totalCount = db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ?')
    .get(req.user.openid).n;
  const todayRow = db
    .prepare('SELECT duration_minutes FROM checkins WHERE openid = ? AND checkin_date = ?')
    .get(req.user.openid, today);
  res.json({
    weekKey,
    weekCount,
    totalCount,
    target: config.weeklyTarget,
    achieved: weekCount >= config.weeklyTarget,
    todayCheckin: todayRow ? { duration: todayRow.duration_minutes } : null,
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

// 构建单个排行榜：weekKey 按周筛选，datePrefix 按 checkin_date 前缀筛选，二者都无则为总榜
function buildBoard({ weekKey, datePrefix }) {
  let rows;
  if (weekKey) {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid AND c.week_key = ?
          GROUP BY u.openid
          ORDER BY count DESC, u.created_at ASC`
      )
      .all(weekKey);
  } else if (datePrefix) {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid AND c.checkin_date LIKE ?
          GROUP BY u.openid
          ORDER BY count DESC, u.created_at ASC`
      )
      .all(datePrefix + '%');
  } else {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid
          GROUP BY u.openid
          ORDER BY count DESC, u.created_at ASC`
      )
      .all();
  }
  return rows.map((r) => ({
    openid: r.openid,
    nickname: r.nickname || '未设置昵称',
    avatarUrl: r.avatarUrl || '',
    count: r.count,
  }));
}

// GET /api/stats/rankings  多榜单：本周/上周/本月/上月/本年/总榜
router.get('/stats/rankings', authRequired, (req, res) => {
  const defs = [
    { key: 'thisWeek', label: '本周', weekly: true, weekKey: currentWeekKey() },
    { key: 'lastWeek', label: '上周', weekly: true, weekKey: lastWeekKey() },
    { key: 'thisMonth', label: '本月', datePrefix: currentMonthStr() },
    { key: 'lastMonth', label: '上月', datePrefix: lastMonthStr() },
    { key: 'thisYear', label: '本年', datePrefix: currentYearStr() },
    { key: 'allTime', label: '总榜' },
  ];

  const boards = defs.map((d) => {
    const list = buildBoard(d).map((item) => ({
      ...item,
      achieved: d.weekly ? item.count >= config.weeklyTarget : false,
    }));
    return { key: d.key, label: d.label, weekly: !!d.weekly, list };
  });

  res.json({ target: config.weeklyTarget, boards });
});

module.exports = router;

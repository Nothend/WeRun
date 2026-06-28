const express = require('express');
const db = require('../db');
const config = require('../config');
const { authRequired, activeRequired } = require('../auth');
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
router.get('/stats/me', authRequired, activeRequired, (req, res) => {
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

// GET /api/stats/me/checkins?scope=week|all  我的打卡明细
router.get('/stats/me/checkins', authRequired, activeRequired, (req, res) => {
  const scope = req.query.scope === 'week' ? 'week' : 'all';
  const weekKey = currentWeekKey();
  const baseSql = `SELECT checkin_date AS date, duration_minutes AS duration, week_key AS weekKey,
                          created_at AS createdAt
                     FROM checkins WHERE openid = ?`;
  const rows =
    scope === 'week'
      ? db.prepare(`${baseSql} AND week_key = ? ORDER BY checkin_date DESC`).all(req.user.openid, weekKey)
      : db.prepare(`${baseSql} ORDER BY checkin_date DESC`).all(req.user.openid);

  res.json({
    scope,
    weekKey,
    count: rows.length,
    totalMinutes: Math.round(rows.reduce((s, r) => s + (r.duration || 0), 0)),
    list: rows.map((r) => ({ ...r, duration: Math.round(r.duration) })),
  });
});

// GET /api/stats/group  群周榜（本周）
router.get('/stats/group', authRequired, activeRequired, (req, res) => {
  const weekKey = currentWeekKey();
  const rows = db
    .prepare(
      `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl,
              COUNT(c.id) AS weekCount
         FROM users u
         LEFT JOIN checkins c ON c.openid = u.openid AND c.week_key = ?
        WHERE u.status = 'active'
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
    isSponsor: config.isSponsor(r.openid),
    sponsorBadge: config.sponsorBadgeFor(r.openid),
  }));

  res.json({
    weekKey,
    target: config.weeklyTarget,
    achievedCount: list.filter((x) => x.achieved).length,
    total: list.length,
    list,
  });
});

// GET /api/stats/feed  今日打卡动态（按提交时间倒序，仅当天）
router.get('/stats/feed', authRequired, activeRequired, (req, res) => {
  const today = localDateStr();
  const rows = db
    .prepare(
      `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl,
              c.duration_minutes AS duration, c.created_at AS createdAt
         FROM checkins c JOIN users u ON u.openid = c.openid
        WHERE c.checkin_date = ? AND u.status = 'active'
        ORDER BY c.created_at DESC`
    )
    .all(today);

  res.json({
    date: today,
    count: rows.length,
    list: rows.map((r) => ({
      openid: r.openid,
      nickname: r.nickname || '未设置昵称',
      avatarUrl: r.avatarUrl || '',
      duration: Math.round(r.duration),
      createdAt: r.createdAt,
      isSponsor: config.isSponsor(r.openid),
      sponsorBadge: config.sponsorBadgeFor(r.openid),
    })),
  });
});

// 构建单个排行榜：weekKey 按周筛选，datePrefix 按 checkin_date 前缀筛选，二者都无则为总榜
function buildBoard({ weekKey, datePrefix }) {
  let rows;
  if (weekKey) {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count,
                COALESCE(SUM(c.duration_minutes),0) AS minutes
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid AND c.week_key = ?
          WHERE u.status = 'active'
          GROUP BY u.openid
          ORDER BY count DESC, minutes DESC, u.created_at ASC`
      )
      .all(weekKey);
  } else if (datePrefix) {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count,
                COALESCE(SUM(c.duration_minutes),0) AS minutes
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid AND c.checkin_date LIKE ?
          WHERE u.status = 'active'
          GROUP BY u.openid
          ORDER BY count DESC, minutes DESC, u.created_at ASC`
      )
      .all(datePrefix + '%');
  } else {
    rows = db
      .prepare(
        `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, COUNT(c.id) AS count,
                COALESCE(SUM(c.duration_minutes),0) AS minutes
           FROM users u
           LEFT JOIN checkins c ON c.openid = u.openid
          WHERE u.status = 'active'
          GROUP BY u.openid
          ORDER BY count DESC, minutes DESC, u.created_at ASC`
      )
      .all();
  }
  return rows.map((r) => ({
    openid: r.openid,
    nickname: r.nickname || '未设置昵称',
    avatarUrl: r.avatarUrl || '',
    count: r.count,
    isSponsor: config.isSponsor(r.openid),
    sponsorBadge: config.sponsorBadgeFor(r.openid),
  }));
}

// GET /api/stats/user/:openid  指定成员各周期打卡情况（逐天明细）
router.get('/stats/user/:openid', authRequired, activeRequired, (req, res) => {
  const { openid } = req.params;
  const user = db
    .prepare("SELECT nickname, avatar_url AS avatarUrl FROM users WHERE openid = ? AND status = 'active'")
    .get(openid);
  if (!user) return res.status(404).json({ error: '成员不存在' });

  const rows = db
    .prepare(
      `SELECT checkin_date AS date, duration_minutes AS duration, week_key AS weekKey,
              created_at AS createdAt
         FROM checkins WHERE openid = ? ORDER BY checkin_date DESC`
    )
    .all(openid);

  const thisWeek = currentWeekKey();
  const lastWeek = lastWeekKey();
  const thisMonth = currentMonthStr();
  const lastMonth = lastMonthStr();
  const thisYear = currentYearStr();
  const defs = [
    { key: 'thisWeek', label: '本周', weekly: true, filter: (r) => r.weekKey === thisWeek },
    { key: 'lastWeek', label: '上周', weekly: true, filter: (r) => r.weekKey === lastWeek },
    { key: 'thisMonth', label: '本月', weekly: false, filter: (r) => r.date.startsWith(thisMonth) },
    { key: 'lastMonth', label: '上月', weekly: false, filter: (r) => r.date.startsWith(lastMonth) },
    { key: 'thisYear', label: '本年', weekly: false, filter: (r) => r.date.startsWith(thisYear) },
    { key: 'allTime', label: '总览', weekly: false, filter: () => true },
  ];

  const periods = defs.map((d) => {
    const list = rows.filter(d.filter).map((r) => ({ ...r, duration: Math.round(r.duration) }));
    return {
      key: d.key,
      label: d.label,
      weekly: d.weekly,
      count: list.length,
      totalMinutes: Math.round(list.reduce((s, r) => s + (r.duration || 0), 0)),
      achieved: d.weekly ? list.length >= config.weeklyTarget : false,
      list,
    };
  });

  res.json({
    user: {
      nickname: user.nickname || '未设置昵称',
      avatarUrl: user.avatarUrl || '',
      isSponsor: config.isSponsor(openid),
      sponsorBadge: config.sponsorBadgeFor(openid),
    },
    target: config.weeklyTarget,
    periods,
  });
});

// GET /api/stats/rankings  多榜单：本周/上周/本月/上月/本年/总榜
router.get('/stats/rankings', authRequired, activeRequired, (req, res) => {
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

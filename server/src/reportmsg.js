// 周期战报消息：cron 在每周/月/年「最后一天 23:45」生成一条持久化消息，
// 首页报告卡按「未读」展示；用户点开即标记已读、回首页即消失。
// 内容（个人小结）按 checkins 现算，不存库。
const db = require('./db');
const config = require('./config');
const { currentWeekKey, currentMonthStr, currentYearStr } = require('./week');

// report_key 前缀 -> 展示元数据。board 为排行榜对应 swiper 板 key（见 ranking.js）
const META = {
  week:  { label: '本周战报', board: 'thisWeek',  unit: '本周' },
  month: { label: '本月战报', board: 'thisMonth', unit: '本月' },
  year:  { label: '本年战报', board: 'thisYear',  unit: '今年' },
};
// 多条同时未读时的展示优先级：年 > 月 > 周
const PRIORITY = { year: 3, month: 2, week: 1 };

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
function beijing(now = new Date()) {
  return new Date(now.getTime() + BEIJING_OFFSET_MS);
}

// 北京时间今天是否为各周期最后一天（ISO 周以周日结束）
function isLastDayOfWeek(b) {
  return b.getUTCDay() === 0;
}
function isLastDayOfMonth(b) {
  const tomorrow = new Date(b.getTime() + 24 * 60 * 60 * 1000);
  return tomorrow.getUTCMonth() !== b.getUTCMonth();
}
function isLastDayOfYear(b) {
  return b.getUTCMonth() === 11 && b.getUTCDate() === 31;
}

// cron 在每天 23:45 调用：若今天是周/月/年最后一天则生成对应战报消息（INSERT OR IGNORE 幂等）。
// 23:45 时这些周期尚未结束，故用 current* 取「即将收尾的本周/本月/本年」。
function generateDueReports(now = new Date()) {
  const b = beijing(now);
  const ts = Date.now();
  const ins = db.prepare('INSERT OR IGNORE INTO report_messages (report_key, created_at) VALUES (?, ?)');
  const created = [];
  if (isLastDayOfWeek(b))  { const k = `week:${currentWeekKey(now)}`;   if (ins.run(k, ts).changes) created.push(k); }
  if (isLastDayOfMonth(b)) { const k = `month:${currentMonthStr(now)}`; if (ins.run(k, ts).changes) created.push(k); }
  if (isLastDayOfYear(b))  { const k = `year:${currentYearStr(now)}`;   if (ins.run(k, ts).changes) created.push(k); }
  if (created.length) console.log(`[report-msg] ${new Date().toISOString()} 生成战报消息: ${created.join(', ')}`);
  return created;
}

// 某用户在某战报周期内的打卡小结
function summaryFor(openid, type, period) {
  const row = type === 'week'
    ? db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(duration_minutes),0) AS m FROM checkins WHERE openid = ? AND week_key = ?').get(openid, period)
    : db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(duration_minutes),0) AS m FROM checkins WHERE openid = ? AND checkin_date LIKE ?').get(openid, period + '%');
  const count = row.n || 0;
  const minutes = Math.round(row.m || 0);
  const s = { count, minutes };
  if (type === 'week') s.achieved = count >= config.weeklyTarget;
  return s;
}

function buildText(type, s) {
  const unit = META[type].unit;
  if (type === 'week') {
    return s.achieved
      ? `${unit}打卡 ${s.count} 次 · ${s.minutes} 分钟 · 已达标 🎉`
      : `${unit}打卡 ${s.count} 次 · ${s.minutes} 分钟，继续加油`;
  }
  return `${unit}累计打卡 ${s.count} 次 · ${s.minutes} 分钟`;
}

// 某用户的未读战报（年>月>周）。仅展示其加入之后生成的战报，晚加入者不补发旧战报。
function listUnreadFor(user) {
  const rows = db
    .prepare(
      `SELECT m.report_key AS key, m.created_at AS createdAt
         FROM report_messages m
         LEFT JOIN report_reads r ON r.report_key = m.report_key AND r.openid = ?
        WHERE r.report_key IS NULL AND m.created_at >= ?`
    )
    .all(user.openid, user.created_at || 0);

  const items = rows
    .map((r) => {
      const [type, period] = r.key.split(':');
      const meta = META[type];
      if (!meta) return null;
      const summary = summaryFor(user.openid, type, period);
      return {
        key: r.key,
        type,
        label: meta.label,
        board: meta.board,
        summary,
        text: buildText(type, summary),
        createdAt: r.createdAt,
      };
    })
    .filter(Boolean);

  items.sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || b.createdAt - a.createdAt);
  return items;
}

// 标记某用户某条战报已读（仅限真实存在的消息）
function markRead(openid, key) {
  const exists = db.prepare('SELECT 1 FROM report_messages WHERE report_key = ?').get(key);
  if (!exists) return false;
  db.prepare('INSERT OR IGNORE INTO report_reads (openid, report_key, read_at) VALUES (?, ?, ?)').run(openid, key, Date.now());
  return true;
}

module.exports = { generateDueReports, listUnreadFor, markRead };

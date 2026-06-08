// ISO 周计算工具：周一为一周开始，返回如 "2026-W23" 的 week_key

function getISOWeek(date) {
  // 复制并归零到当天 UTC，避免时区误差
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // ISO: 周四决定属于哪一年/哪一周。getUTCDay() 周日=0 → 转成周一=1..周日=7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

// 当前（按本地时间）的 week_key，例如 "2026-W23"
function currentWeekKey(now = new Date()) {
  const { year, week } = getISOWeek(now);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 本地日期字符串 YYYY-MM-DD（用于"每天最多一次"判定）
function localDateStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 给定 "YYYY-MM-DD" 字符串，返回对应的 week_key
function weekKeyForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const { year, week } = getISOWeek(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 上一周的 week_key（取 7 天前那天所属的 ISO 周）
function lastWeekKey(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - 7);
  return currentWeekKey(d);
}

// 本月前缀 "YYYY-MM"（用于按 checkin_date LIKE 'YYYY-MM%' 过滤）
function currentMonthStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 上月前缀 "YYYY-MM"
function lastMonthStr(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 本年前缀 "YYYY"
function currentYearStr(now = new Date()) {
  return String(now.getFullYear());
}

module.exports = {
  currentWeekKey,
  localDateStr,
  weekKeyForDate,
  lastWeekKey,
  currentMonthStr,
  lastMonthStr,
  currentYearStr,
};

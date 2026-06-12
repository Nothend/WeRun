// ISO 周与日期工具：所有"今天/本周/本月"一律按北京时间（UTC+8）计算，
// 不依赖进程时区——生产容器（alpine）默认 UTC，曾导致北京时间 0:00–8:00
// 的打卡被记到前一天（checkin_date / week_key 错位）。
// 做法：时间戳平移 8 小时后用 getUTC* 取值。

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// 取北京时间的年/月/日（month 为 0 起，与 Date 一致）
function beijingParts(now = new Date()) {
  const d = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

// 给定年/月/日，算 ISO 周（周一为一周开始，周四决定归属年/周）
function isoWeekOf(year, month, day) {
  const d = new Date(Date.UTC(year, month, day));
  const dayNum = d.getUTCDay() || 7; // 周日=0 → 周一=1..周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function formatWeekKey({ year, week }) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 当前（北京时间）的 week_key，例如 "2026-W23"
function currentWeekKey(now = new Date()) {
  const { year, month, day } = beijingParts(now);
  return formatWeekKey(isoWeekOf(year, month, day));
}

// 北京日期字符串 YYYY-MM-DD（用于"每天最多一次"判定）
function localDateStr(now = new Date()) {
  const { year, month, day } = beijingParts(now);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 给定 "YYYY-MM-DD" 字符串，返回对应的 week_key（纯字符串解析，与时区无关）
function weekKeyForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatWeekKey(isoWeekOf(y, m - 1, d));
}

// 上一周的 week_key（取 7 天前那一刻所属的 ISO 周）
function lastWeekKey(now = new Date()) {
  return currentWeekKey(new Date(now.getTime() - 7 * 86400000));
}

// 本月前缀 "YYYY-MM"（用于按 checkin_date LIKE 'YYYY-MM%' 过滤）
function currentMonthStr(now = new Date()) {
  const { year, month } = beijingParts(now);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// 上月前缀 "YYYY-MM"
function lastMonthStr(now = new Date()) {
  const { year, month } = beijingParts(now);
  const d = new Date(Date.UTC(year, month - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 本年前缀 "YYYY"
function currentYearStr(now = new Date()) {
  return String(beijingParts(now).year);
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

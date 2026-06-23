// 周报/月报/年报数据层（纯计算，不涉及绘图）。
//
// 「金主」是反向荣誉：某 ISO 周打卡次数 < weeklyTarget 即当周金主（熟人圈罚发红包）。
//  - 周报：本周是否金主（0/1）。
//  - 月报/年报：聚合周期内「已结束」的各 ISO 周，统计每人当了几次周金主，按次数排名。
//    只统计已结束的周（周日 < 今天），进行中的当前周不计入，避免误伤。
//  - 周归属：按该 ISO 周「周一」所在的月/年归类，无歧义。
// 报告只点名、不提金额。

const db = require('./db');
const config = require('./config');
const {
  currentWeekKey,
  lastWeekKey,
  currentMonthStr,
  lastMonthStr,
  currentYearStr,
  localDateStr,
  weekKeyForDate,
} = require('./week');

// 把 'YYYY-MM-DD' 规整到其所在 ISO 周的周一（返回 UTC 零点 Date，纯日历运算）
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // 周一=1 .. 周日=7
  dt.setUTCDate(dt.getUTCDate() - (dow - 1));
  return dt;
}

function fmtDate(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

// 某 ISO 周（"YYYY-Www"）的周一日期字符串（纯日历运算）
function isoWeekMondayStr(weekKey) {
  const [y, w] = weekKey.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4)); // 1月4日一定在第1周
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - (dow - 1) + (w - 1) * 7);
  return fmtDate(mon);
}

// 用户「加入跑团」的北京日期：取「注册小程序日」与「最早一条打卡日（含导入历史）」中较早者。
// 老成员的历史打卡常由 Excel 导入、最近才注册小程序，若只看 created_at 会把他们误判为新人。
function joinDateStr(member) {
  const reg = localDateStr(new Date(member.createdAt || 0));
  const firstCk = db
    .prepare('SELECT MIN(checkin_date) AS d FROM checkins WHERE openid = ?')
    .get(member.openid).d;
  return firstCk && firstCk < reg ? firstCk : reg;
}

// 枚举「周一落在 [year,month] 且整周已结束」的各 ISO 周 week_key。
// month 为空则枚举整年。todayStr 之后（含进行中的当前周）一律不计入。
function completedWeekKeys({ year, month, todayStr }) {
  const weeks = [];
  // 从该年/月第一天所在周的周一起步
  const startStr = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
  let mon = mondayOf(startStr);
  for (let i = 0; i < 60; i++) {
    const sun = new Date(mon);
    sun.setUTCDate(sun.getUTCDate() + 6);
    const monYear = mon.getUTCFullYear();
    const monMonth = mon.getUTCMonth() + 1;
    // 周一已越过目标区间 → 结束
    if (monYear > year || (month && monYear === year && monMonth > month)) break;
    if (!month && monYear > year) break;
    const inPeriod = month ? monYear === year && monMonth === month : monYear === year;
    if (inPeriod && fmtDate(sun) < todayStr) {
      weeks.push(weekKeyForDate(fmtDate(mon)));
    }
    mon = new Date(mon);
    mon.setUTCDate(mon.getUTCDate() + 7);
  }
  return weeks;
}

function activeMembers() {
  return db
    .prepare(
      "SELECT openid, nickname, avatar_url AS avatarUrl, created_at AS createdAt FROM users WHERE status = 'active'"
    )
    .all();
}

// 周期内（按 checkin_date 前缀，或整体）每人的打卡次数与总时长
function aggregateActivity(datePrefix) {
  const rows = datePrefix
    ? db
        .prepare(
          `SELECT openid, COUNT(*) AS count, COALESCE(SUM(duration_minutes),0) AS minutes
             FROM checkins WHERE checkin_date LIKE ? GROUP BY openid`
        )
        .all(datePrefix + '%')
    : db
        .prepare(
          `SELECT openid, COUNT(*) AS count, COALESCE(SUM(duration_minutes),0) AS minutes
             FROM checkins GROUP BY openid`
        )
        .all();
  const map = new Map();
  rows.forEach((r) => map.set(r.openid, { count: r.count, minutes: r.minutes }));
  return map;
}

// node-canvas（cairo）用 CJK 字体无法渲染彩色 emoji，会变成豆腐块/空白，
// 故海报昵称里的 emoji 一律剔除（变体选择符/ZWJ/keycap/区域指示符一并清掉），
// 不影响中文/英文/数字。清空后回退默认名。
function stripEmoji(s = '') {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{20E3}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decorate(member, extra) {
  return {
    openid: member.openid,
    nickname: stripEmoji(member.nickname) || '神秘跑者',
    avatarUrl: member.avatarUrl || '',
    isSponsor: config.isSponsor(member.openid),
    ...extra,
  };
}

// 周报：本周（period='week'）或上周（period='lastweek'）
function buildWeekReport(now = new Date(), { weekKey = currentWeekKey(now), period = 'week' } = {}) {
  const members = activeMembers();
  const counts = new Map(
    db
      .prepare('SELECT openid, COUNT(*) AS n FROM checkins WHERE week_key = ? GROUP BY openid')
      .all(weekKey)
      .map((r) => [r.openid, r.n])
  );
  const weekActivity = new Map(
    db
      .prepare(
        `SELECT openid, COUNT(*) AS count, COALESCE(SUM(duration_minutes),0) AS minutes
           FROM checkins WHERE week_key = ? GROUP BY openid`
      )
      .all(weekKey)
      .map((r) => [r.openid, r])
  );

  const target = config.weeklyTarget;
  const weekMonStr = isoWeekMondayStr(weekKey);
  const sponsors = []; // 金主：未达标（次数 < target），可多人，顶部金冠展示
  const achieved = []; // 达标者：列在分隔线下方，带绿色「达标」
  members.forEach((m) => {
    const n = counts.get(m.openid) || 0;
    const a = weekActivity.get(m.openid) || { count: 0, minutes: 0 };
    const row = decorate(m, { count: n, minutes: Math.round(a.minutes), achieved: n >= target });
    if (n >= target) {
      achieved.push(row);
    } else if (weekMonStr >= joinDateStr(m)) {
      // 仅「该周一前已加入」者未达标才算金主；本周中途加入的不评判、不展示
      sponsors.push(row);
    }
  });

  // 金主：次数升序（垫底的排前）→ 时长升序；达标：次数降序 → 时长降序
  sponsors.sort((x, y) => x.count - y.count || x.minutes - y.minutes);
  achieved.sort((x, y) => y.count - x.count || y.minutes - x.minutes);
  return {
    period,
    periodText: weekKeyToText(weekKey),
    weekKey,
    target,
    memberCount: members.length,
    weeksCounted: 1,
    sponsors,
    achieved,
    noSponsor: sponsors.length === 0,
  };
}

// 月报/年报：聚合已结束的各 ISO 周
function buildAggregateReport(period, now = new Date()) {
  const todayStr = localDateStr(now);
  let year;
  let month = null;
  let datePrefix;
  let periodText;
  if (period === 'month' || period === 'lastmonth') {
    const ms = period === 'month' ? currentMonthStr(now) : lastMonthStr(now); // YYYY-MM
    year = Number(ms.slice(0, 4));
    month = Number(ms.slice(5, 7));
    datePrefix = ms;
    periodText = `${year}年${month}月`;
  } else {
    year = Number(currentYearStr(now)) - (period === 'lastyear' ? 1 : 0);
    datePrefix = String(year);
    periodText = `${year}年`;
  }

  const target = config.weeklyTarget;
  const members = activeMembers();
  const weekKeys = completedWeekKeys({ year, month, todayStr });

  // 各周每人次数 → 金主次数累计；只统计「该周一前已加入」的周（加入前的周不计入达标判定）
  const joinStr = new Map(members.map((m) => [m.openid, joinDateStr(m)]));
  const missCount = new Map(); // openid -> 当金主周数
  const countableWeeks = new Map(); // openid -> 计入达标判定的周数（加入后的完整周）
  members.forEach((m) => {
    missCount.set(m.openid, 0);
    countableWeeks.set(m.openid, 0);
  });
  weekKeys.forEach((wk) => {
    const wkMon = isoWeekMondayStr(wk);
    const counts = new Map(
      db
        .prepare('SELECT openid, COUNT(*) AS n FROM checkins WHERE week_key = ? GROUP BY openid')
        .all(wk)
        .map((r) => [r.openid, r.n])
    );
    members.forEach((m) => {
      if (wkMon < joinStr.get(m.openid)) return; // 加入前/中途加入的那一周不计
      countableWeeks.set(m.openid, countableWeeks.get(m.openid) + 1);
      const n = counts.get(m.openid) || 0;
      if (n < target) missCount.set(m.openid, missCount.get(m.openid) + 1);
    });
  });

  // 月/年榜：先按次数、再按运动时长排序；加入后的每个完整周都达标才算「达标」，否则「不达标」
  const activity = aggregateActivity(datePrefix);
  const rows = members
    .map((m) => {
      const a = activity.get(m.openid) || { count: 0, minutes: 0 };
      return decorate(m, {
        count: a.count,
        minutes: Math.round(a.minutes),
        achieved: countableWeeks.get(m.openid) > 0 && missCount.get(m.openid) === 0,
      });
    })
    .sort((x, y) => y.count - x.count || y.minutes - x.minutes);

  return {
    period,
    periodText,
    target,
    memberCount: members.length,
    weeksCounted: weekKeys.length,
    rows,
    noSponsor: rows.every((r) => r.achieved),
  };
}

// "2026-W25" → "2026年第25周"
function weekKeyToText(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  return m ? `${m[1]}年第${Number(m[2])}周` : weekKey;
}

function buildReport(period, now = new Date()) {
  if (period === 'week') return buildWeekReport(now);
  if (period === 'lastweek') {
    return buildWeekReport(now, { weekKey: lastWeekKey(now), period: 'lastweek' });
  }
  if (['month', 'lastmonth', 'year', 'lastyear'].includes(period)) {
    return buildAggregateReport(period, now);
  }
  throw new Error(`未知报告周期: ${period}`);
}

module.exports = { buildReport, completedWeekKeys };

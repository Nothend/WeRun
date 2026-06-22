const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { authRequired, adminRequired } = require('../auth');
const { buildReport } = require('../report');
const { renderReportPoster } = require('../poster');

const router = express.Router();

fs.mkdirSync(config.reportDir, { recursive: true });

const PERIODS = new Set(['week', 'lastweek', 'month', 'lastmonth', 'year', 'lastyear']);

// 北京时间（用 getUTC* 读取平移后的时间）
function beijing(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

// 本周榜仅在「周五 22:00 之后」开放（周六/周日仍属本周，照常允许）；否则回退上周。
function canGenThisWeek(now = new Date()) {
  const b = beijing(now);
  const isoDow = b.getUTCDay() === 0 ? 7 : b.getUTCDay(); // 周一=1 .. 周日=7
  if (isoDow > 5) return true;
  return isoDow === 5 && b.getUTCHours() >= 22;
}

// 本月榜仅在「月底当天 23:40 之后」开放；否则回退上月。
function canGenThisMonth(now = new Date()) {
  const b = beijing(now);
  const tomorrow = new Date(b.getTime() + 24 * 60 * 60 * 1000);
  const isLastDay = tomorrow.getUTCMonth() !== b.getUTCMonth();
  return isLastDay && b.getUTCHours() * 60 + b.getUTCMinutes() >= 23 * 60 + 40;
}

// 本年榜仅在「12 月 31 日 23:40 之后」开放；否则回退去年。
function canGenThisYear(now = new Date()) {
  const b = beijing(now);
  const isLastDay = b.getUTCMonth() === 11 && b.getUTCDate() === 31;
  return isLastDay && b.getUTCHours() * 60 + b.getUTCMinutes() >= 23 * 60 + 40;
}

// 本周期未结束时，自动回退到「上一个已结束周期」，并附带提示文案
const FALLBACK = {
  week: { can: canGenThisWeek, prev: 'lastweek', notice: '本周尚未结束，已为你生成上周榜' },
  month: { can: canGenThisMonth, prev: 'lastmonth', notice: '本月尚未到月底，只能生成上月月榜' },
  year: { can: canGenThisYear, prev: 'lastyear', notice: '本年尚未到年底，只能生成去年年榜' },
};

// GET /api/report/:period(week|lastweek|month|lastmonth|year|lastyear)  生成金主报告海报（仅管理员）
// 渲染 PNG 写入 data/reports/<period>.png，返回带时间戳的公网 URL 供小程序预览/分享。
router.get('/report/:period', authRequired, adminRequired, async (req, res) => {
  const { period } = req.params;
  if (!PERIODS.has(period)) return res.status(400).json({ error: '未知报告周期' });
  try {
    let effPeriod = period;
    let notice = '';
    const fb = FALLBACK[period];
    if (fb && !fb.can()) {
      effPeriod = fb.prev;
      notice = fb.notice;
    }
    const report = buildReport(effPeriod);
    const buf = await renderReportPoster(report);
    fs.writeFileSync(path.join(config.reportDir, `${effPeriod}.png`), buf);
    const url = `${config.publicBaseUrl}/reports/${effPeriod}.png?t=${Date.now()}`;
    res.json({ url, period: effPeriod, periodText: report.periodText, notice });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

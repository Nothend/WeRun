const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../auth');
const { recognizeDuration } = require('../qwen');
const { currentWeekKey, localDateStr } = require('../week');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function weekCountOf(openid, weekKey) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
    .get(openid, weekKey).n;
}

// POST /api/checkin  multipart: image(file)
router.post('/checkin', authRequired, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少图片' });

    const openid = req.user.openid;
    const weekKey = currentWeekKey();
    const today = localDateStr();

    // 先查今天是否已打卡（每天最多一次）——避免无谓调用大模型
    const existing = db
      .prepare('SELECT * FROM checkins WHERE openid = ? AND checkin_date = ?')
      .get(openid, today);
    if (existing) {
      return res.json({
        success: false,
        already: true,
        reason: '今天已经打过卡啦',
        duration: existing.duration_minutes,
        weekCount: weekCountOf(openid, weekKey),
        target: config.weeklyTarget,
      });
    }

    // 调用千问识别时长（不保存原图）
    const result = await recognizeDuration(req.file.buffer, req.file.mimetype || 'image/jpeg');

    if (!result.has_time) {
      return res.json({ success: false, reason: '未在图中识别到运动时间，请上传清晰的跑步记录截图' });
    }
    const duration = Number(result.duration_minutes) || 0;
    if (duration < config.minDurationMinutes) {
      return res.json({
        success: false,
        duration,
        reason: `识别到运动时长约 ${duration} 分钟，未达到 ${config.minDurationMinutes} 分钟`,
      });
    }

    // 记录打卡
    try {
      db.prepare(
        'INSERT INTO checkins (openid, week_key, checkin_date, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(openid, weekKey, today, duration, Date.now());
    } catch (e) {
      // 并发下的唯一约束冲突，按"今天已打卡"处理
      if (String(e.message).includes('UNIQUE')) {
        return res.json({ success: false, already: true, reason: '今天已经打过卡啦' });
      }
      throw e;
    }

    const weekCount = weekCountOf(openid, weekKey);
    res.json({
      success: true,
      duration,
      weekCount,
      target: config.weeklyTarget,
      achieved: weekCount >= config.weeklyTarget,
      mock: result.mock || false,
    });
  } catch (e) {
    console.error('checkin error:', e);
    res.status(500).json({ error: e.message || '打卡失败' });
  }
});

module.exports = router;

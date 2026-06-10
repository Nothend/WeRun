const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authRequired, activeRequired } = require('../auth');
const { recognizeDuration } = require('../qwen');
const { computeDHash, hammingDistance } = require('../phash');
const { sendCheckinNotify } = require('../wechat');
const { currentWeekKey, localDateStr } = require('../week');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function weekCountOf(openid, weekKey) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
    .get(openid, weekKey).n;
}

// 通知所有开启了接收打卡消息的管理员（fire-and-forget，不影响响应）
async function notifyAdmins(checkerOpenid, durationMinutes, weekCount) {
  try {
    const admins = db
      .prepare('SELECT openid FROM users WHERE is_admin = 1 AND notify_checkin = 1')
      .all();
    if (!admins.length) return;

    const checker = db.prepare('SELECT nickname FROM users WHERE openid = ?').get(checkerOpenid);
    const nickname = checker?.nickname || '未设昵称';

    for (const admin of admins) {
      await sendCheckinNotify(admin.openid, {
        nickname,
        durationMinutes,
        weekCount,
        weekTarget: config.weeklyTarget,
      });
    }
  } catch (e) {
    console.error('[notify] notifyAdmins error:', e.message);
  }
}

// POST /api/checkin  multipart: image(file)
router.post('/checkin', authRequired, activeRequired, upload.single('image'), async (req, res) => {
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

    // ── 防作弊：图片哈希查重（全局，不限本人，防止共用同一张截图）──
    const imageHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const hashUsed = db.prepare('SELECT id FROM checkins WHERE image_hash = ?').get(imageHash);
    if (hashUsed) {
      return res.json({
        success: false,
        reason: '该截图已被使用过，请上传新的运动记录截图',
      });
    }

    // ── 感知哈希（dHash）计算与记录 ──────────────────────────
    // 注：实测同一张图压缩/缩放前后的 256bit dHash 汉明距离可达 ~18，
    // 而同一运动App模板、不同记录的两张不同截图距离可低至 ~6——两者区间有重叠，
    // 全局阈值拦截会有误伤真实打卡的风险。因此暂不作为拦截依据，
    // 仅记录疑似相似（distance <= IMAGE_SIMILARITY_LOG_THRESHOLD）供管理员排查，
    // 积累真实样本后再评估是否启用拦截及合适阈值。
    let phash = null;
    try {
      phash = await computeDHash(req.file.buffer);
      const others = db
        .prepare('SELECT id, openid, phash FROM checkins WHERE phash IS NOT NULL')
        .all();
      for (const row of others) {
        const dist = hammingDistance(phash, row.phash);
        if (dist <= config.imageSimilarityLogThreshold) {
          console.warn(
            `[phash] 疑似相似截图: openid=${openid} 与 checkin#${row.id}(openid=${row.openid}) 汉明距离=${dist}/256`
          );
        }
      }
    } catch (e) {
      console.error('[phash] compute error:', e.message);
      // 感知哈希计算失败不影响主流程
    }

    // 调用千问识别时长与运动日期（不保存原图）
    const result = await recognizeDuration(req.file.buffer, req.file.mimetype || 'image/jpeg');

    // AI 识别的日期和时长——无论成功失败都返回给前端展示
    const recognizedDate = result.exercise_date || null;
    const duration = Number(result.duration_minutes) || 0;

    if (!result.has_time) {
      return res.json({
        success: false,
        reason: '未在图中识别到运动时间，请上传清晰的跑步记录截图',
        exercise_date: recognizedDate,
        duration: 0,
      });
    }

    // 运动日期仅供展示，不作为拒绝依据：
    // AI 可能因图片压缩等原因识别出错，打卡日期统一以服务器当日为准
    if (duration < config.minDurationMinutes) {
      return res.json({
        success: false,
        duration,
        exercise_date: recognizedDate,
        reason: `识别到运动时长约 ${duration} 分钟，未达到 ${config.minDurationMinutes} 分钟`,
      });
    }

    // 记录打卡（含图片哈希、感知哈希）
    try {
      db.prepare(
        'INSERT INTO checkins (openid, week_key, checkin_date, duration_minutes, image_hash, phash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(openid, weekKey, today, duration, imageHash, phash, Date.now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.json({ success: false, already: true, reason: '今天已经打过卡啦' });
      }
      throw e;
    }

    const weekCount = weekCountOf(openid, weekKey);

    // 异步通知管理员（不等待，不影响响应时间）
    notifyAdmins(openid, duration, weekCount);

    res.json({
      success: true,
      duration,
      exercise_date: recognizedDate,
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

// DELETE /api/checkin/today  撤销当天打卡（仅限当天）
router.delete('/checkin/today', authRequired, activeRequired, (req, res) => {
  const today = localDateStr();
  const info = db
    .prepare('DELETE FROM checkins WHERE openid = ? AND checkin_date = ?')
    .run(req.user.openid, today);
  if (!info.changes) return res.status(404).json({ error: '今天尚未打卡' });
  res.json({ ok: true });
});

module.exports = router;

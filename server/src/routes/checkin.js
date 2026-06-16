const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authRequired, activeRequired } = require('../auth');
const { recognizeDuration } = require('../qwen');
const { computeDHash, hammingDistance } = require('../phash');
const { imgSecCheck } = require('../wechat');
const { currentWeekKey, localDateStr } = require('../week');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function weekCountOf(openid, weekKey) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE openid = ? AND week_key = ?')
    .get(openid, weekKey).n;
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
        durationSeconds: existing.duration_seconds || 0,
        hasSeconds: !!existing.has_seconds,
        weekCount: weekCountOf(openid, weekKey),
        target: config.weeklyTarget,
      });
    }

    // ── 防作弊①：图片字节哈希查重（全局，不限本人，防止重复上传同一张截图原图）──
    const imageHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const hashUsed = db.prepare('SELECT id FROM checkins WHERE image_hash = ?').get(imageHash);
    if (hashUsed) {
      return res.json({
        success: false,
        reason: '该截图已被使用过，请上传新的运动记录截图',
      });
    }

    // ── 平台内容安全检测：违规图片直接拒绝（接口异常 fail-open 放行）──
    // 由 SCREENSHOT_SEC_CHECK 开关控制是否送检；送检时记录耗时，成功后返回给前端展示
    let secCheckMs = null;
    if (config.screenshotSecCheck) {
      const t0 = Date.now();
      const passed = await imgSecCheck(req.file.buffer);
      secCheckMs = Date.now() - t0;
      if (!passed) {
        return res.json({ success: false, reason: '图片含违规信息，请更换截图' });
      }
    }

    // ── 感知哈希（dHash）计算 ──────────────────────────
    // 先算好备用：是否用于拦截取决于下面 AI 识别结果（是否精确到秒）
    let phash = null;
    let phashRows = [];
    try {
      phash = await computeDHash(req.file.buffer);
      phashRows = db
        .prepare('SELECT id, openid, phash FROM checkins WHERE phash IS NOT NULL')
        .all();
    } catch (e) {
      console.error('[phash] compute error:', e.message);
      // 感知哈希计算失败不影响主流程
    }

    // 调用千问识别时长与运动日期（不保存原图）
    const tRecognize = Date.now();
    const result = await recognizeDuration(req.file.buffer, req.file.mimetype || 'image/jpeg');
    const recognizeMs = Date.now() - tRecognize;
    // 留痕：出现"同图不同时长"等识别漂移时可复盘
    console.log(`[qwen] openid=${openid} 识别结果: ${JSON.stringify(result)}`);

    // AI 识别的日期——无论成功失败都返回给前端展示
    const recognizedDate = result.exercise_date || null;
    const durationSeconds = Number(result.duration_seconds) || 0;
    const hasSeconds = !!result.has_seconds;

    if (!result.has_time) {
      return res.json({
        success: false,
        reason: '未能从截图中读取到运动时长，请上传清晰的跑步记录截图',
        exercise_date: recognizedDate,
        duration: 0,
      });
    }

    const duration = Math.round(durationSeconds / 60);

    // ── 防作弊⓪：运动日期校验（防止翻旧截图反复打卡）────────────
    // 截图必须能识别出运动日期（含"今天/昨天"等相对日期，由 AI 按今天日期换算），
    // 且在允许范围内：今天起向前 screenshotMaxLagDays 天（默认 1，照顾
    // "晚上跑完次日早上打卡"）。无论截图日期是今天还是昨天，打卡都记在提交当天。
    const allowedDates = new Set();
    for (let i = 0; i <= config.screenshotMaxLagDays; i++) {
      allowedDates.add(localDateStr(new Date(Date.now() - i * 86400000)));
    }
    if (!recognizedDate) {
      return res.json({
        success: false,
        duration,
        durationSeconds,
        hasSeconds,
        exercise_date: null,
        reason: '未能从截图中读取到运动日期，请截取包含日期（或"今天"字样）的完整运动记录页面',
      });
    }
    if (!allowedDates.has(recognizedDate)) {
      return res.json({
        success: false,
        duration,
        durationSeconds,
        hasSeconds,
        exercise_date: recognizedDate,
        reason: `截图中的运动日期为 ${recognizedDate}，仅支持${config.screenshotMaxLagDays > 0 ? '今天或昨天' : '今天'}的运动记录`,
      });
    }

    if (durationSeconds < config.minDurationMinutes * 60) {
      return res.json({
        success: false,
        duration,
        durationSeconds,
        hasSeconds,
        exercise_date: recognizedDate,
        reason: `截图中的运动时长约 ${duration} 分钟，未达到 ${config.minDurationMinutes} 分钟`,
      });
    }

    // ── 防作弊②：秒级时长指纹去重 + 感知哈希视觉去重（两者都跑）──────
    // "日期+总秒数"指纹防换设备重截：两人独立运动撞到同一秒的概率极低，撞上
    // 基本可判定为盗用他人截图。但指纹依赖 AI 每次读出相同秒数，识别漂移
    // （同图读出 2495/2555）或微信转发重压缩都可能绕过它，故 dHash 视觉相似度
    // 无条件兜底拦截，不再只在无秒级精度时启用；阈值待积累真实距离分布后微调。
    let fingerprint = null;
    if (hasSeconds) {
      fingerprint = `${today}_${durationSeconds}`;
      const fpHit = db.prepare('SELECT id FROM checkins WHERE fingerprint = ?').get(fingerprint);
      if (fpHit) {
        return res.json({
          success: false,
          duration,
          durationSeconds,
          hasSeconds,
          exercise_date: recognizedDate,
          reason: '疑似使用了他人的截图，请上传你本人的运动记录',
        });
      }
    }
    if (phash) {
      for (const row of phashRows) {
        const dist = hammingDistance(phash, row.phash);
        const willBlock = dist <= config.imageSimilarityBlockThreshold;
        if (willBlock || dist <= config.imageSimilarityLogThreshold) {
          console.warn(
            `[phash] 疑似相似截图: openid=${openid} 与 checkin#${row.id}(openid=${row.openid}) 汉明距离=${dist}/256${willBlock ? ' → 已拦截' : ''}`
          );
        }
        if (willBlock) {
          return res.json({
            success: false,
            duration,
            durationSeconds,
            hasSeconds,
            exercise_date: recognizedDate,
            reason: '该截图与已有打卡记录过于相似，请上传你本人的运动记录截图',
          });
        }
      }
    }

    // 记录打卡（含图片哈希、感知哈希、秒级指纹）
    try {
      db.prepare(
        'INSERT INTO checkins (openid, week_key, checkin_date, duration_minutes, duration_seconds, has_seconds, image_hash, phash, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(openid, weekKey, today, duration, durationSeconds, hasSeconds ? 1 : 0, imageHash, phash, fingerprint, Date.now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        if (fingerprint) {
          return res.json({
            success: false,
            duration,
            durationSeconds,
            hasSeconds,
            exercise_date: recognizedDate,
            reason: '疑似使用了他人的截图，请上传你本人的运动记录',
          });
        }
        return res.json({ success: false, already: true, reason: '今天已经打过卡啦' });
      }
      throw e;
    }

    const weekCount = weekCountOf(openid, weekKey);

    res.json({
      success: true,
      duration,
      durationSeconds,
      hasSeconds,
      exercise_date: recognizedDate,
      weekCount,
      target: config.weeklyTarget,
      achieved: weekCount >= config.weeklyTarget,
      secCheckMs,
      recognizeMs,
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

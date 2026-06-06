const express = require('express');
const config = require('../config');

const router = express.Router();

// GET /api/config — 公开接口，返回前端需要的运行时配置
router.get('/config', (req, res) => {
  res.json({
    minDurationMinutes: config.minDurationMinutes,
    weeklyTarget: config.weeklyTarget,
  });
});

module.exports = router;

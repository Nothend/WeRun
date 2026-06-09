const express = require('express');
const config = require('../config');

const router = express.Router();

// GET /api/config — 公开接口，返回前端需要的运行时配置
router.get('/config', (req, res) => {
  res.json({
    minDurationMinutes: config.minDurationMinutes,
    weeklyTarget: config.weeklyTarget,
    // 订阅消息模板ID：小程序调 wx.requestSubscribeMessage 时需要
    applyTemplateId:  config.applyTemplateId,
    weeklyTemplateId: config.weeklyTemplateId,
  });
});

module.exports = router;

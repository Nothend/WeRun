const express = require('express');
const config = require('../config');
const db = require('../db');

const router = express.Router();

const getNotice = db.prepare("SELECT value FROM settings WHERE key = 'notice'");

// GET /api/config — 公开接口，返回前端需要的运行时配置
router.get('/config', (req, res) => {
  const noticeRow = getNotice.get();
  res.json({
    minDurationMinutes: config.minDurationMinutes,
    weeklyTarget: config.weeklyTarget,
    // 订阅消息模板ID：小程序调 wx.requestSubscribeMessage 时需要
    applyTemplateId:  config.applyTemplateId,
    weeklyTemplateId: config.weeklyTemplateId,
    // 「关于作者」页的支持区块开关（默认隐藏，平台不允许个人主体出现赞赏内容）
    showSupport: config.showSupport,
    // 后台 Excel 导入功能开关（默认隐藏，仅历史数据迁移时开启）
    showImport: config.showImport,
    // 首页滚动公告文本（管理员后台可改，空字符串表示不展示公告栏）
    noticeText: (noticeRow && noticeRow.value) || '',
  });
});

module.exports = router;

// 金主报告海报：node-canvas 绘制，输出 PNG buffer。
// 金色暗调风格，所有装饰（钻石/皇冠/奖牌）矢量绘制，不依赖 emoji 字体。

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const config = require('./config');

const W = 750;
const PAD = 48;
const FONT = '"Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif';

const C = {
  bgTop: '#161d27',
  bgBottom: '#0b0a08',
  gold: '#f5c542',
  goldLight: '#ffe6a3',
  goldDeep: '#c8902a',
  white: '#f3f4f6',
  muted: '#9aa3ad',
  card: '#1b2230',
  cardAlt: '#212a39',
  green: '#07c160', // 达标（与小程序排行榜一致）
  red: '#e7604f', // 不达标
};

function f(weight, size) {
  return `${weight} ${size}px ${FONT}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 文本超宽则截断加省略号
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function goldText(ctx, text, x, y, size, align = 'left') {
  const g = ctx.createLinearGradient(0, y - size, 0, y + size * 0.3);
  g.addColorStop(0, C.goldLight);
  g.addColorStop(1, C.goldDeep);
  ctx.font = f('bold', size);
  ctx.textAlign = align;
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

// 矢量钻石
function diamond(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  const g = ctx.createLinearGradient(0, -s, 0, s);
  g.addColorStop(0, C.goldLight);
  g.addColorStop(1, C.goldDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.8, -s * 0.2);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.8, -s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-s * 0.8, -s * 0.2);
  ctx.lineTo(s * 0.8, -s * 0.2);
  ctx.moveTo(0, -s);
  ctx.lineTo(0, s);
  ctx.stroke();
  ctx.restore();
}

// 矢量皇冠（用于第一名）
function crown(ctx, cx, cy, w) {
  const h = w * 0.7;
  ctx.save();
  ctx.translate(cx, cy);
  const g = ctx.createLinearGradient(0, -h, 0, 0);
  g.addColorStop(0, C.goldLight);
  g.addColorStop(1, C.goldDeep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w / 2, -h * 0.45);
  ctx.lineTo(-w * 0.25, -h * 0.05);
  ctx.lineTo(0, -h);
  ctx.lineTo(w * 0.25, -h * 0.05);
  ctx.lineTo(w / 2, -h * 0.45);
  ctx.lineTo(w / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 圆形头像 + 可选金环；无图则首字母色块
function drawAvatar(ctx, img, nickname, cx, cy, r, ring) {
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    const rg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rg.addColorStop(0, C.goldLight);
    rg.addColorStop(1, C.goldDeep);
    ctx.fillStyle = rg;
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#2c3543';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = C.goldLight;
    ctx.font = f('bold', r);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((nickname || '?').slice(0, 1), cx, cy + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

async function preloadAvatars(report) {
  const ids = new Set();
  [...(report.sponsors || []), ...(report.achieved || []), ...(report.rows || [])].forEach((s) =>
    ids.add(s.openid)
  );
  const map = new Map();
  for (const openid of ids) {
    const p = path.join(config.avatarDir, `${openid}.png`);
    if (fs.existsSync(p)) {
      try {
        map.set(openid, await loadImage(p));
      } catch (e) {
        /* 忽略坏图，回退首字母 */
      }
    }
  }
  return map;
}

// 横向分隔线
function divider(ctx, y) {
  ctx.strokeStyle = 'rgba(245,197,66,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
}

// 状态小药丸（达标=绿、不达标=红），返回药丸宽度
function statusPill(ctx, text, color, xRight, cy, size = 22) {
  ctx.font = f('bold', size);
  const tw = ctx.measureText(text).width;
  const padX = size >= 22 ? 14 : 10;
  const w = tw + padX * 2;
  const h = size + 12;
  const x = xRight - w;
  roundRect(ctx, x, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = hexA(color, 0.14);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, cy + 8);
  return w;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// 金主组：多个「金冠头像 + 昵称」，居中、自动换行（人多时多行）
function drawCrownGroup(ctx, list, avatars, y) {
  const r = 42;
  const cellW = 150;
  const crownTop = 30; // 皇冠占用的顶部高度
  const cellH = crownTop + r * 2 + 56; // 皇冠 + 头像 + 昵称行，行间留足避免下一行皇冠压昵称
  const perRow = Math.max(1, Math.min(list.length, Math.floor((W - 2 * PAD) / cellW)));
  for (let i = 0; i < list.length; i += perRow) {
    const rowItems = list.slice(i, i + perRow);
    const totalW = rowItems.length * cellW;
    let x = (W - totalW) / 2 + cellW / 2;
    rowItems.forEach((s) => {
      const cyAva = y + crownTop + r;
      drawAvatar(ctx, avatars.get(s.openid), s.nickname, x, cyAva, r, true);
      crown(ctx, x, cyAva - r - 4, 46);
      ctx.textAlign = 'center';
      // 昵称按宽度自动缩字号（28→18），长名优雅缩小而非直接截断；极长才省略号
      const nameMaxW = cellW - 10;
      let nsize = 28;
      ctx.font = f('bold', nsize);
      while (nsize > 18 && ctx.measureText(s.nickname).width > nameMaxW) {
        ctx.font = f('bold', --nsize);
      }
      goldText(ctx, ellipsize(ctx, s.nickname, nameMaxW), x, cyAva + r + 30, nsize, 'center');
      ctx.textAlign = 'left';
      x += cellW;
    });
    y += cellH;
  }
  return y;
}

// 达标网格：弹性列数（人少 1 列，人多自动 2/3 列），每格 头像+昵称+绿色达标
function drawAchievedGrid(ctx, list, avatars, y) {
  const n = list.length;
  const cols = n <= 5 ? 1 : n <= 12 ? 2 : 3;
  const gap = 16;
  const cellW = (W - 2 * PAD - gap * (cols - 1)) / cols;
  const rowH = 60;
  const ar = 22;
  list.forEach((s, i) => {
    const col = i % cols;
    const cx = PAD + col * (cellW + gap);
    const cy = y + rowH / 2;
    drawAvatar(ctx, avatars.get(s.openid), s.nickname, cx + ar, cy, ar, false);
    const pillW = cols >= 3 ? 0 : 1; // 三列太窄时省略药丸，只用绿色昵称表示达标
    let nameRight = cx + cellW;
    if (pillW) {
      const w = statusPill(ctx, '达标', C.green, cx + cellW, cy);
      nameRight = cx + cellW - w - 12;
    }
    ctx.fillStyle = pillW ? C.white : C.green;
    ctx.font = f('bold', 26);
    ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, s.nickname, nameRight - (cx + ar * 2 + 10)), cx + ar * 2 + 10, cy + 9);
    if (col === cols - 1 || i === n - 1) y += rowH;
  });
  return y;
}

function fmtDur(min) {
  return min < 60 ? `${min}分钟` : `${(min / 60).toFixed(1)}小时`;
}

// 排行榜（月/年榜）：单列，按次数→时长排序，最多展示前 15 名，其余不显示。
// 每行：名次 + 头像 + 昵称 + N次(时长) + 达标/不达标。
function drawRankList(ctx, list, avatars, y) {
  const rows = list.slice(0, 15);
  const rowH = 76;
  const rowGap = 12;
  rows.forEach((s, i) => {
    roundRect(ctx, PAD, y, W - 2 * PAD, rowH, 16);
    ctx.fillStyle = i % 2 ? C.cardAlt : C.card;
    ctx.fill();
    const cy = y + rowH / 2;
    // 名次
    ctx.fillStyle = i < 3 ? C.gold : C.muted;
    ctx.font = f('bold', 28);
    ctx.textAlign = 'center';
    const rankX = PAD + 34;
    ctx.fillText(String(i + 1), rankX, cy + 8);
    ctx.textAlign = 'left';
    // 头像
    const ar = 26;
    const avaX = rankX + 32 + ar;
    drawAvatar(ctx, avatars.get(s.openid), s.nickname, avaX, cy, ar, false);
    // 右侧：达标/不达标药丸 + 「N次（时长）」
    const pw = statusPill(ctx, s.achieved ? '达标' : '不达标', s.achieved ? C.green : C.red, W - PAD - 14, cy);
    const statsText = `${s.count}次（${fmtDur(s.minutes)}）`;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.muted;
    ctx.font = f('normal', 24);
    const sw = ctx.measureText(statsText).width;
    ctx.fillText(statsText, W - PAD - 14 - pw - 16, cy + 8);
    // 昵称
    ctx.textAlign = 'left';
    ctx.fillStyle = C.white;
    ctx.font = f('bold', 28);
    const nameX = avaX + ar + 12;
    const nameMaxW = W - PAD - 14 - pw - 16 - sw - 16 - nameX;
    ctx.fillText(ellipsize(ctx, s.nickname, Math.max(48, nameMaxW)), nameX, cy + 9);
    y += rowH + rowGap;
  });
  return y;
}

// 绘制全部内容，返回内容总高度。avatars 预加载好，故同步。
function drawContent(ctx, report, copy, avatars) {
  let y = 0;

  // 顶部品牌条
  y = 70;
  ctx.font = f('bold', 26);
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.fillText('WeRun', PAD, y);
  ctx.font = f('normal', 22);
  ctx.fillText('· 跑步打卡', PAD + ctx.measureText('WeRun').width + 10, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.muted;
  ctx.font = f('normal', 22);
  ctx.fillText(report.periodText, W - PAD, y);
  ctx.textAlign = 'left';

  // 大标题
  y += 78;
  goldText(ctx, copy.title, PAD, y, 56);

  // 标题下分隔线 + 钻石
  y += 36;
  ctx.strokeStyle = 'rgba(245,197,66,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W / 2 - 28, y);
  ctx.moveTo(W / 2 + 28, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  diamond(ctx, W / 2, y, 14);

  // Hero 文案
  y += 78;
  ctx.textAlign = 'center';
  ctx.fillStyle = copy.celebrate ? C.goldLight : C.white;
  ctx.font = f('bold', 44);
  ctx.fillText(copy.headline, W / 2, y);
  y += 44;
  ctx.fillStyle = C.muted;
  ctx.font = f('normal', 26);
  ctx.fillText(copy.subline, W / 2, y);
  ctx.textAlign = 'left';

  if (report.period === 'week' || report.period === 'lastweek') {
    // 周榜：金主（金冠头像，可多人）在上；横线分隔；达标者（绿色「达标」）在下、弹性多列
    if (report.noSponsor) {
      // 皇冠以 y 为底向上绘制（高约 116*0.7≈81），留足间距避免顶到上方的副标题
      y += 112;
      crown(ctx, W / 2, y, 116);
      y += 46;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.goldLight;
      ctx.font = f('bold', 32);
      ctx.fillText('全员达标 · 无人成为金主', W / 2, y);
      ctx.textAlign = 'left';
      y += 26;
    } else {
      y += 32;
      y = drawCrownGroup(ctx, report.sponsors, avatars, y);
    }
    if (report.achieved && report.achieved.length) {
      y += 30;
      divider(ctx, y);
      y += 18;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted;
      ctx.font = f('normal', 24);
      ctx.fillText(`已达标 ${report.achieved.length} 人`, W / 2, y + 6);
      ctx.textAlign = 'left';
      y += 44;
      y = drawAchievedGrid(ctx, report.achieved, avatars, y);
    }
    y += 12;
  } else {
    // 月/年榜：排行榜（先次数后时长），昵称后标注达标/不达标
    y += 28;
    y = drawRankList(ctx, report.rows || [], avatars, y);
    y += 12;
  }

  // 页脚
  y += 36;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 44;
  ctx.fillStyle = C.muted;
  ctx.font = f('normal', 22);
  ctx.textAlign = 'center';
  ctx.fillText('WeRun 跑步打卡 · 一起跑下去', W / 2, y);
  ctx.textAlign = 'left';
  y += 40;

  return y;
}

function drawBackground(ctx, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h);
  // 顶部金色光晕
  const rg = ctx.createRadialGradient(W / 2, 60, 20, W / 2, 60, 420);
  rg.addColorStop(0, 'rgba(245,197,66,0.18)');
  rg.addColorStop(1, 'rgba(245,197,66,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, 480);
  // 顶部金线
  ctx.fillStyle = C.gold;
  ctx.fillRect(0, 0, W, 6);
}

async function renderReportPoster(report) {
  const copy = require('./reportCopy').buildCopy(report);
  const avatars = await preloadAvatars(report);

  // 测量高度（临时画布）
  const measure = createCanvas(W, 4000).getContext('2d');
  const contentH = drawContent(measure, report, copy, avatars);
  const H = Math.ceil(contentH + PAD);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, H);
  drawContent(ctx, report, copy, avatars);
  return canvas.toBuffer('image/png');
}

module.exports = { renderReportPoster };

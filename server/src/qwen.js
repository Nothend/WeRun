const config = require('./config');

const PROMPT = [
  '这是一张跑步/运动记录的截图（可能来自 Keep、悦跑圈、微信运动、华为/小米运动等）。',
  '请你识别以下两项内容：',
  '1. 图中的"运动时长"（即本次运动持续的总时间，换算为分钟）',
  '2. 图中的"运动日期"（即本次运动发生的日期，格式 YYYY-MM-DD；若无法识别则为 null）',
  '严格只返回一个 JSON 对象，不要任何多余文字或解释，格式如下：',
  '{"has_time": true 或 false, "duration_minutes": 数字, "exercise_date": "YYYY-MM-DD" 或 null}',
  '其中 has_time 表示图中是否包含可识别的运动时长；',
  'duration_minutes 为该时长换算成的分钟数（例如 "32:15" → 32，"1小时05分" → 65）；',
  'exercise_date 为本次运动的日期（若图中有明确日期则返回，否则返回 null）。',
  '若图中没有明确的运动时长，则 has_time 为 false，duration_minutes 为 0。',
].join('\n');

function extractJson(text) {
  if (!text) return null;
  // 去掉可能的 ```json ... ``` 代码围栏
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 输入图片 Buffer + mime，返回 { has_time, duration_minutes }
async function recognizeDuration(imageBuffer, mime = 'image/jpeg') {
  if (config.useMockQwen) {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const exercise_date = `${today.getFullYear()}-${mm}-${dd}`;
    return { has_time: true, duration_minutes: 35, exercise_date, mock: true };
  }

  const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`;
  const resp = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: config.qwenModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`千问识别失败(${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  // content 可能是字符串，也可能是数组（部分实现）
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
    : content;

  const parsed = extractJson(text);
  if (!parsed) {
    return { has_time: false, duration_minutes: 0, raw: text };
  }
  return {
    has_time: !!parsed.has_time,
    duration_minutes: Number(parsed.duration_minutes) || 0,
    exercise_date: parsed.exercise_date || null,
  };
}

// 用于分享文案生成的文字模型（非 VL）
const SHARE_TEXT_MODEL = process.env.QWEN_TEXT_MODEL || 'qwen-turbo';

// 生成个人打卡分享文案
async function generateShareText({ nickname, weekCount, weekTarget, totalCount, achieved }) {
  if (config.useMockQwen) {
    const flag = achieved ? '🎯 已达标！' : '💪 继续冲！';
    return `${flag} ${nickname} 本周跑步打卡 ${weekCount}/${weekTarget} 次，历史累计 ${totalCount} 次。来 WeRun 一起打卡吧！`;
  }
  const prompt = `请根据以下跑步打卡数据，为用户「${nickname}」生成一段分享到微信好友的文案（50字以内，积极励志风格，加1-2个emoji）。
本周打卡：${weekCount}/${weekTarget} 次 ${achieved ? '（已达标）' : '（未达标）'}
历史累计：${totalCount} 次`;

  const resp = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.dashscopeApiKey}` },
    body: JSON.stringify({ model: SHARE_TEXT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`AI 文案生成失败(${resp.status})`);
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim()
    || `${nickname} 本周打卡 ${weekCount}/${weekTarget} 次，一起来 WeRun 跑步吧！`;
}

// 生成群组周报分享文案（管理员用）
async function generateGroupShareText({ weekKey, achievedCount, total, target, topRunners }) {
  if (config.useMockQwen) {
    return `🏃 WeRun 跑步群 ${weekKey}：${total} 人参与，${achievedCount} 人达标（≥${target}次）！本周前三：${topRunners.join('、')}。一起奔跑，一起进步！`;
  }
  const prompt = `请根据跑步群本周数据，生成一段群公告风格的分享文案（60字以内，加2-3个emoji）。
周次：${weekKey}，参与：${total} 人，达标（≥${target}次）：${achievedCount} 人
本周前三：${topRunners.join('、')}`;

  const resp = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.dashscopeApiKey}` },
    body: JSON.stringify({ model: SHARE_TEXT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`AI 文案生成失败(${resp.status})`);
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim()
    || `跑步群本周 ${achievedCount}/${total} 人达标，继续加油！`;
}

module.exports = { recognizeDuration, generateShareText, generateGroupShareText };

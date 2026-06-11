const config = require('./config');

const PROMPT = [
  '这是一张跑步/运动记录的截图（可能来自 Keep、悦跑圈、微信运动、华为/小米运动等）。',
  '请你识别以下内容：',
  '1. 图中的"运动时长"，换算为总秒数；',
  '2. 该时长在图中是否精确显示到"秒"（即格式形如 32:18 或 01:32:18，包含秒数；',
  '   若只显示为"32分钟"、"约30分钟"、"0.5小时"等不含秒的形式，则视为不精确到秒）；',
  '3. 图中的"运动日期"（即本次运动发生的日期，格式 YYYY-MM-DD；若无法识别则为 null）。',
  '严格只返回一个 JSON 对象，不要任何多余文字或解释，格式如下：',
  '{"has_time": true 或 false, "duration_seconds": 数字, "has_seconds": true 或 false, "exercise_date": "YYYY-MM-DD" 或 null}',
  '其中 has_time 表示图中是否包含可识别的运动时长；',
  'duration_seconds 为该时长换算成的总秒数（例如 "32:18" → 1938，"32分钟" → 1920，"1小时05分" → 3900）；',
  'has_seconds 表示图中显示的时长格式是否精确到秒（"32:18" → true，"32分钟"/"约30分钟" → false）；',
  'exercise_date 为本次运动的日期（若图中有明确日期则返回，否则返回 null）。',
  '若图中没有明确的运动时长，则 has_time 为 false，duration_seconds 为 0，has_seconds 为 false。',
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

// 输入图片 Buffer + mime，返回 { has_time, duration_seconds, has_seconds, exercise_date }
async function recognizeDuration(imageBuffer, mime = 'image/jpeg') {
  if (config.useMockQwen) {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const exercise_date = `${today.getFullYear()}-${mm}-${dd}`;
    // 加入随机秒数抖动，避免同一天所有 mock 用户的「日期+秒级时长」指纹完全相同
    const duration_seconds = 35 * 60 + Math.floor(Math.random() * 60);
    return { has_time: true, duration_seconds, has_seconds: true, exercise_date, mock: true };
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
    return { has_time: false, duration_seconds: 0, has_seconds: false, raw: text };
  }
  return {
    has_time: !!parsed.has_time,
    duration_seconds: Math.max(0, Math.round(Number(parsed.duration_seconds) || 0)),
    has_seconds: !!parsed.has_seconds,
    exercise_date: parsed.exercise_date || null,
  };
}

// 用于分享文案生成的文字模型（非 VL）
const SHARE_TEXT_MODEL = process.env.QWEN_TEXT_MODEL || 'qwen-turbo';

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

module.exports = { recognizeDuration, generateGroupShareText };

const crypto = require('crypto');
const config = require('./config');

// 用 wx.login 拿到的 code 换取 openid。
// 未配置真实 APPID/APPSECRET 时走 mock：用 code 派生一个稳定的假 openid，便于联调。
async function code2session(code) {
  if (config.useMockWechat) {
    const openid = 'mock_' + crypto.createHash('md5').update(String(code)).digest('hex').slice(0, 16);
    return { openid };
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.appid}&secret=${config.appsecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.errcode) {
    throw new Error(`微信登录失败(${data.errcode}): ${data.errmsg}`);
  }
  return { openid: data.openid, sessionKey: data.session_key };
}

// ── Access Token 缓存 ──────────────────────────────────────
let _accessToken = null;
let _tokenExpireAt = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpireAt) return _accessToken;
  if (config.useMockWechat) return null;

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appid}&secret=${config.appsecret}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.errcode) throw new Error(`获取 access_token 失败(${data.errcode}): ${data.errmsg}`);

  _accessToken = data.access_token;
  _tokenExpireAt = Date.now() + (data.expires_in - 300) * 1000; // 提前 5 分钟过期
  return _accessToken;
}

// 向指定 openid 发送打卡订阅消息。调用方负责 try/catch，失败不影响主流程。
// 模板字段约定（在微信公众平台创建模板时按此定义）：
//   thing1  → 打卡成员
//   number2 → 运动时长(分钟)
//   phrase3 → 本周状态
//   date4   → 打卡时间
async function sendCheckinNotify(toOpenid, { nickname, durationMinutes, weekCount, weekTarget }) {
  if (!config.wechatNotifyTemplateId) return;

  const token = await getAccessToken();
  if (!token) return;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const achieved = weekCount >= weekTarget;
  const phaseStr = achieved ? '本周已达标' : `本周${weekCount}/${weekTarget}次`;

  const body = {
    touser: toOpenid,
    template_id: config.wechatNotifyTemplateId,
    page: 'pages/index/index',
    miniprogram_state: 'formal',
    data: {
      thing1:  { value: nickname.slice(0, 20) },
      number2: { value: String(durationMinutes) },
      phrase3: { value: phaseStr },
      date4:   { value: dateStr },
    },
  };

  const sendResp = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const sendData = await sendResp.json();
  if (sendData.errcode && sendData.errcode !== 0) {
    console.warn(`[notify] 发送打卡通知失败 openid=${toOpenid} errcode=${sendData.errcode}: ${sendData.errmsg}`);
  }
}

module.exports = { code2session, getAccessToken, sendCheckinNotify };

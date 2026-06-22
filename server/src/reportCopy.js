// 报告文案：模板 + 随机变体。只点名、不提金额。

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TITLES = {
  week: '本周金主榜',
  lastweek: '上周金主榜',
  month: 'WeRun月度排行榜',
  year: 'WeRun年度排行榜',
};

const NO_HEADLINE = {
  week: '很遗憾，本周没有人成为金主',
  lastweek: '上周无人成为金主',
  month: '本月全员达标！',
  year: '全年全员达标！',
};
const NO_SUBLINE = {
  week: ['满勤一周，红包安全', '无人破功，下周继续'],
  lastweek: ['上周满勤，红包安全', '上周无人破功，给力'],
  month: ['本月人人月月达标，神仙跑团', '整月零金主，自律天花板', '一整月没人破功，佩服'],
  year: ['全年零金主，封神之年', '一整年无人破功，离谱的自律', '年度满勤，教科书级坚持'],
};

const YES_HEADLINE = {
  week: '恭喜成为本周金主！',
  lastweek: '上周金主名单出炉！',
  month: '坚持就是胜利',
  year: '日拱一卒，功不唐捐',
};
const YES_SUBLINE = {
  week: ['没达标的就是你们了', '本周破功名单，请发言', '差一点点，下周雪耻'],
  lastweek: ['上周没达标的就是你们了', '上周破功名单，请发言', '上周差一点点，本周雪耻'],
  month: ['次数为王，时长见真章', '日积月累，强者养成'],
  year: ['全年坚持，闪闪发光', '这一年，跑出来的勋章'],
};

// 给定报告数据，产出本期文案
function buildCopy(report) {
  const { noSponsor } = report;
  // 上月/去年沿用月/年文案（标题不含「本月/今年」字样，periodText 已带年月）
  const period = report.period === 'lastmonth' ? 'month' : report.period === 'lastyear' ? 'year' : report.period;
  if (noSponsor) {
    return {
      title: TITLES[period],
      celebrate: true,
      headline: NO_HEADLINE[period],
      subline: pick(NO_SUBLINE[period]),
    };
  }
  return {
    title: TITLES[period],
    celebrate: false,
    headline: YES_HEADLINE[period],
    subline: pick(YES_SUBLINE[period]),
  };
}

module.exports = { buildCopy };

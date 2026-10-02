export const VOD_KIND_ORDER = ['movie', 'series', 'short', 'variety', 'anime', 'adult', 'other'];

export const VOD_KIND_LABELS = {
  movie: '電影',
  series: '劇集',
  short: '短劇',
  variety: '綜藝',
  anime: '動漫',
  adult: '成人18+',
  other: '其他',
};

export function normalizeRuleText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADULT_RE =
  /伦理|倫理|伦理片|倫理片|写真|寫真|福利|成人|情色|色情|三级|三級|麻豆|番号|AV|直播秀|无码AV|无码|無碼|有码|有碼|女优|女優|自慰|人妻|巨乳|强奸|強姦|乱伦|亂倫|制服诱惑|制服誘惑|探花|偷拍|自拍偷拍|抖阴|抖陰|VR视角|VR視角|口交|颜射|顏射|SM调教|SM調教|里番|裏番|黄漫|黃漫|激情动漫|激情動漫|成人动漫|成人動漫/i;

const SHORT_CATEGORY_RE =
  /短剧|短劇|微短剧|微短劇|爽文短剧|爽文短劇|女频恋爱|女頻戀愛|反转爽剧|反轉爽劇|反转爽文|反轉爽文|古装仙侠|古裝仙俠|年代穿越|穿越年代|现代都市|現代都市|现代言情|現代言情|女恋总裁|女戀總裁|闪婚离婚|閃婚離婚|重生民国|重生民國|脑洞悬疑|腦洞懸疑|都市脑洞|都市腦洞|总裁|總裁|赘婿|贅婿|仙侠|仙俠|民国短剧|民國短劇/i;

const VARIETY_CATEGORY_RE =
  /综艺|綜藝|大陆综艺|大陸綜藝|国产综艺|國產綜藝|港台综艺|港台綜藝|日韩综艺|日韓綜藝|欧美综艺|歐美綜藝|韩国综艺|韓國綜藝|真人秀|脱口秀|脫口秀|选秀|選秀|综艺片|綜藝片/i;

const SERIES_CATEGORY_RE =
  /连续剧|連續劇|电视剧|電視劇|剧集|劇集|大陆剧|大陸劇|陆剧|陸劇|国产剧|國產劇|内地剧|內地劇|中国剧|中國劇|港台剧|港台劇|港澳剧|港澳劇|香港剧|香港劇|港剧|港劇|台湾剧|台灣劇|台剧|台劇|日韩剧|日韓劇|日本剧|日本劇|日剧|日劇|韩国剧|韓國劇|韩剧|韓劇|美国剧|美國劇|美剧|美劇|英剧|英劇|欧美剧|歐美劇|泰国剧|泰國劇|泰剧|泰劇|马泰剧|馬泰劇|海外剧|海外劇|Netflix自制剧|Netflix自製劇|自制剧|自製劇|短剧以外剧集/i;

const MOVIE_CATEGORY_RE =
  /电影|電影|电影片|電影片|影片|动作片|動作片|喜剧片|喜劇片|爱情片|愛情片|科幻片|恐怖片|剧情片|劇情片|战争片|戰爭片|纪录片|紀錄片|记录片|犯罪片|悬疑片|懸疑片|惊悚片|驚悚片|冒险片|冒險片|奇幻片|灾难片|災難片|预告片|預告片|邵氏电影|邵氏電影|Netflix电影|Netflix電影|4K电影|4K電影|西部片|家庭片|短片|电影解说|電影解說|影视解说|影視解說|紀錄|纪录|记录/i;

const ANIME_CATEGORY_RE =
  /动漫|動漫|国产动漫|國產動漫|中国动漫|中國動漫|日韩动漫|日韓動漫|日本动漫|日本動漫|欧美动漫|歐美動漫|港台动漫|港台動漫|海外动漫|海外動漫|有声动漫|有聲動漫|动漫精品|動漫精品|动漫精选|動漫精選|动漫片|動漫片|动漫电影|動漫電影|动画片|動畫片|动画电影|動畫電影|卡通动画|卡通動畫|卡通动漫|卡通動漫|剧情动漫|劇情動漫|番剧|番劇|番组|番組|漫剧|漫劇|AI漫剧|AI漫劇|卡通|少儿|少兒/i;

const SPORTS_OR_OTHER_RE = /体育|體育|足球|篮球|籃球|网球|網球|斯诺克|斯諾克|排球|棒球|电竞|電競|演唱会|演唱會|音乐|音樂/i;

function matchCategoryKind(text) {
  if (!text) return '';
  if (ADULT_RE.test(text)) return 'adult';
  if (SHORT_CATEGORY_RE.test(text)) return 'short';
  if (VARIETY_CATEGORY_RE.test(text)) return 'variety';
  if (SERIES_CATEGORY_RE.test(text)) return 'series';
  if (ANIME_CATEGORY_RE.test(text)) return 'anime';
  if (MOVIE_CATEGORY_RE.test(text)) return 'movie';
  if (SPORTS_OR_OTHER_RE.test(text)) return 'other';
  return '';
}

function matchFallbackKind(text) {
  if (!text) return '';
  if (ADULT_RE.test(text)) return 'adult';
  if (SHORT_CATEGORY_RE.test(text)) return 'short';
  if (VARIETY_CATEGORY_RE.test(text)) return 'variety';
  if (SERIES_CATEGORY_RE.test(text)) return 'series';
  if (ANIME_CATEGORY_RE.test(text) || /动画|動畫|番|二次元/i.test(text)) return 'anime';
  if (MOVIE_CATEGORY_RE.test(text)) return 'movie';
  if (/动作|動作|喜剧|喜劇|爱情|愛情|科幻|恐怖|剧情|劇情|战争|戰爭|犯罪|悬疑|懸疑|惊悚|驚悚|冒险|冒險|奇幻|灾难|災難/i.test(text)) return 'movie';
  if (SPORTS_OR_OTHER_RE.test(text)) return 'other';
  return '';
}

export function classifyVodKind(input, sourceAdult = false) {
  if (typeof input === 'string') {
    if (sourceAdult) return 'adult';
    return matchCategoryKind(normalizeRuleText(input)) || matchFallbackKind(normalizeRuleText(input)) || 'movie';
  }

  const categoryText = normalizeRuleText(input?.categoryName ?? input?.typeName ?? input?.category ?? input?.type ?? '');
  const genreText = Array.isArray(input?.genre) ? normalizeRuleText(input.genre.join(' ')) : normalizeRuleText(input?.genre ?? input?.vodClass ?? input?.class ?? '');
  const titleText = normalizeRuleText(input?.title ?? input?.vodName ?? '');
  const adult = Boolean(sourceAdult || input?.sourceAdult || input?.adult);
  if (adult || ADULT_RE.test(`${categoryText} ${genreText}`)) return 'adult';

  const categoryKind = matchCategoryKind(categoryText);
  if (categoryKind) return categoryKind;

  return matchFallbackKind(`${genreText} ${titleText}`) || 'movie';
}

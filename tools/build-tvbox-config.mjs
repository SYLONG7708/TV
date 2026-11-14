import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const next = process.argv[i + 1];
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
}

const repoRoot = path.resolve(args.get('repoRoot') || path.resolve(import.meta.dirname, '..'));
const input = path.resolve(args.get('input') || path.join(repoRoot, 'sources', 'All on-demand sources'));
const output = path.resolve(args.get('output') || path.join(repoRoot, 'sources', 'TVBOX'));
const EXCLUDED_TVBOX_SOURCE_KEYS = new Set([
  '旺旺资源',
  '旺旺短剧',
  '卧龙资源',
  '金鹰点播',
  '华视影院',
  '百万资源',
  '美少女',
  '黄AVZY',
  '白嫖资源',
  '丝袜资源',
  '优优资源',
]);

async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function trimString(value) {
  return String(value || '').trim();
}

function normalizeInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeCategories(value) {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set();
  const categories = [];
  for (const item of value) {
    const category = trimString(item);
    if (!category || seen.has(category)) continue;
    seen.add(category);
    categories.push(category);
  }
  return categories.length ? categories : undefined;
}

const TVBOX_CATEGORY_KIND_ORDER = ['movie', 'anime', 'short', 'variety'];
const IQIYI_ORIGIN_API = 'https://iqiyizyapi.com/api.php/provide/vod/';
const IQIYI_RECOMMEND_JS_API =
  'https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/oktv-iqiyi-latest.js';
const IQIYI_TVBOX_CATEGORIES = [
  '\u52a8\u4f5c\u7247',
  '\u56fd\u4ea7\u52a8\u6f2b',
  '\u77ed\u5267',
  '\u5927\u9646\u7efc\u827a',
];
const IQIYI_API_RE = /^https?:\/\/iqiyizyapi\.com\/api\.php\/provide\/vod\/?/i;

const HENTAI_CATEGORY_RE = /里番|裏番|成人动漫|成人動漫/i;
const ADULT_ANIME_CATEGORY_RE =
  /动漫|動漫|动画|動畫|卡通|漫画|漫畫|漫剧|漫劇|番剧|番劇|同人|二次元|3D动漫|3D動漫/i;
const SHORT_CATEGORY_RE =
  /短剧|短劇|微短剧|微短劇|爽文短剧|爽文短劇|擦边短剧|擦邊短劇|女频恋爱|女頻戀愛|反转爽剧|反轉爽劇|反转爽文|反轉爽文|古装仙侠|古裝仙俠|年代穿越|穿越年代|穿越现代|穿越現代|现代都市|現代都市|现代言情|現代言情|言情总裁|言情總裁|悬疑烧脑|懸疑燒腦|脑洞悬疑|腦洞懸疑|都市脑洞|都市腦洞|女恋总裁|女戀總裁|闪婚离婚|閃婚離婚|重生民国|重生民國|成长逆袭|成長逆襲|总裁|總裁|赘婿|贅婿|仙侠|仙俠/i;
const VARIETY_CATEGORY_RE =
  /综艺|綜藝|大陆综艺|大陸綜藝|国产综艺|國產綜藝|港台综艺|港台綜藝|日韩综艺|日韓綜藝|欧美综艺|歐美綜藝|韩国综艺|韓國綜藝|真人秀|脱口秀|脫口秀|选秀|選秀|演唱会|演唱會|娱乐|娛樂/i;
const ANIME_CATEGORY_RE =
  /动漫|動漫|国产动漫|國產動漫|中国动漫|中國動漫|日韩动漫|日韓動漫|日本动漫|日本動漫|欧美动漫|歐美動漫|港台动漫|港台動漫|海外动漫|海外動漫|有声动漫|有聲動漫|动漫电影|動漫電影|动画电影|動畫電影|动画片|動畫片|番剧|番劇|番组|番組|漫剧|漫劇|AI漫剧|AI漫劇|卡通|少儿|少兒/i;
const MOVIE_OR_SERIES_CATEGORY_RE =
  /电影|電影|电影片|電影片|影片|连续剧|連續劇|电视剧|電視劇|剧集|劇集|大陆剧|大陸劇|国产剧|國產劇|内地剧|內地劇|中国剧|中國劇|港台剧|港台劇|港澳剧|港澳劇|香港剧|香港劇|台湾剧|台灣劇|日韩剧|日韓劇|日本剧|日本劇|日剧|日劇|韩国剧|韓國劇|韩剧|韓劇|美剧|美劇|英剧|英劇|欧美剧|歐美劇|泰国剧|泰國劇|泰剧|泰劇|马泰剧|馬泰劇|海外剧|海外劇|动作片|動作片|喜剧片|喜劇片|爱情片|愛情片|科幻片|恐怖片|剧情片|劇情片|战争片|戰爭片|纪录片|紀錄片|记录片|犯罪片|悬疑片|懸疑片|惊悚片|驚悚片|冒险片|冒險片|奇幻片|灾难片|災難片|预告片|預告片|邵氏电影|邵氏電影|4K电影|4K電影|西部片|家庭片|家庭篇|短片|电影解说|電影解說|影视解说|影視解說|伦理|倫理|三级|三級/i;
const SPORTS_OR_UTILITY_CATEGORY_RE =
  /体育|體育|足球|篮球|籃球|网球|網球|斯诺克|斯諾克|排球|棒球|电竞|電競|公告|头条|頭條|资讯|資訊|新闻|新聞|演员|演員|科普|学习|學習|未分类|未分類|其他赛事|其他賽事/i;

function detectTvboxCategoryKind(category, sourceAdult) {
  const text = trimString(category).normalize('NFKC');
  if (!text) return '';
  if (HENTAI_CATEGORY_RE.test(text) || (sourceAdult && ADULT_ANIME_CATEGORY_RE.test(text))) {
    return 'hentai';
  }
  if (SHORT_CATEGORY_RE.test(text)) return 'short';
  if (VARIETY_CATEGORY_RE.test(text)) return 'variety';
  if (ANIME_CATEGORY_RE.test(text)) return 'anime';
  if (MOVIE_OR_SERIES_CATEGORY_RE.test(text)) return 'movie';
  if (sourceAdult && !SPORTS_OR_UTILITY_CATEGORY_RE.test(text)) return 'movie';
  return '';
}

function categoryPreference(category, kind) {
  const text = trimString(category).normalize('NFKC');
  if (!text) return 100;
  if (kind === 'hentai') {
    if (/^里番动漫$|^里番動漫$|^裏番动漫$|^裏番動漫$/i.test(text)) return 0;
    if (/成人动漫|成人動漫/i.test(text)) return 1;
    if (/动漫精品|動漫精品|动漫精选|動漫精選|卡通动漫|卡通動漫|动漫区|動漫區|3D动漫|3D動漫|同人动漫|同人動漫|激情动漫|激情動漫/i.test(text)) return 2;
    if (ADULT_ANIME_CATEGORY_RE.test(text)) return 8;
    return 20;
  }
  if (kind === 'anime') {
    if (/^(国产动漫|國產動漫|中国动漫|中國動漫|日韩动漫|日韓動漫|日本动漫|日本動漫|欧美动漫|歐美動漫|港台动漫|港台動漫|海外动漫|海外動漫)$/i.test(text)) return 0;
    if (/动漫片|動漫片|动画片|動畫片|动漫电影|動漫電影|动画电影|動畫電影|有声动漫|有聲動漫|番剧|番劇|漫剧|漫劇|卡通/i.test(text)) return 2;
    if (/^动漫$|^動漫$/i.test(text)) return 20;
    return 10;
  }
  if (kind === 'short') {
    if (/^短剧$|^短劇$/i.test(text)) return 0;
    if (/短剧大全|短劇大全/i.test(text)) return 1;
    return 2;
  }
  if (kind === 'variety') {
    if (/^(大陆综艺|大陸綜藝|国产综艺|國產綜藝|港台综艺|港台綜藝|日韩综艺|日韓綜藝|欧美综艺|歐美綜藝|韩国综艺|韓國綜藝)$/i.test(text)) return 0;
    if (/综艺片|綜藝片|真人秀|脱口秀|脫口秀|演唱会|演唱會/i.test(text)) return 2;
    if (/^综艺$|^綜藝$/i.test(text)) return 20;
    return 10;
  }
  if (kind === 'movie') {
    if (/电影片|電影片/i.test(text)) return 0;
    if (/动作片|動作片|喜剧片|喜劇片|爱情片|愛情片|科幻片|恐怖片|剧情片|劇情片|战争片|戰爭片|纪录片|紀錄片|记录片|犯罪片|悬疑片|懸疑片|惊悚片|驚悚片|冒险片|冒險片|奇幻片|灾难片|災難片|西部片|家庭片|短片|预告片|預告片|邵氏电影|邵氏電影|4K电影|4K電影/i.test(text)) return 2;
    if (/连续剧|連續劇|电视剧|電視劇|剧集|劇集|国产剧|國產劇|香港剧|香港劇|台湾剧|台灣劇|日本剧|日本劇|韩国剧|韓國劇|欧美剧|歐美劇|泰剧|泰劇|海外剧|海外劇/i.test(text)) return 8;
    if (/^电影$|^電影$/i.test(text)) return 20;
    return 10;
  }
  return 100;
}

function normalizeTvboxCategories(value, sourceAdult) {
  const sourceCategories = normalizeCategories(value);
  if (!sourceCategories) return undefined;

  const selected = new Map();
  sourceCategories.forEach((category, index) => {
    const kind = detectTvboxCategoryKind(category, sourceAdult);
    if (!kind) return;
    const score = categoryPreference(category, kind);
    const existing = selected.get(kind);
    if (!existing || score < existing.score || (score === existing.score && index < existing.index)) {
      selected.set(kind, { category, score, index });
    }
  });

  const categories = [];
  for (const kind of TVBOX_CATEGORY_KIND_ORDER) {
    const selectedCategory = selected.get(kind)?.category;
    if (selectedCategory && !categories.includes(selectedCategory)) categories.push(selectedCategory);
  }
  return categories.length ? categories : undefined;
}

const ADULT_SITE_IDENTITY_RE =
  /18\+|avzy|souav|swag|91md|155api|apiyutu|fhapi|apilsb|yytv4|xiaojizy|hsck|apidanaizi|jkunzy|lbapi|naixxzy|slapibf|apilj|shayuapi|douapi|ddapi|heiliao|bwzyz|thzy|jingpin|ckzy|xxibao|xiangjiao|msnii|pgxdy|kxgav|xingba|dadiapi|semaozy|aosika|siwazy|truvaze|fqzy|\u6210\u4eba|\u9ebb\u8c46|\u756a\u53f7|\u9ec4\u8272|\u9ec3\u8272|\u60c5\u8272|\u8001\u8272|\u5927\u5976|\u4e1d\u889c|\u7d72\u896a|\u4ed3\u5e93|\u5009\u5eab|\u674f\u5427|\u8272\u732b|\u9ed1\u6599|\u7cbe\u54c1|\u5965\u65af\u5361|\u5967\u65af\u5361|\bAV\b/i;
const ADULT_CATEGORY_RE =
  /\u6210\u4eba|\u9ebb\u8c46|\u756a\u53f7|\u9ec4\u8272|\u9ec3\u8272|\u60c5\u8272|\u8001\u8272|\u5927\u5976|\u4e1d\u889c|\u7d72\u896a|\u4ed3\u5e93|\u5009\u5eab|\u674f\u5427|\u8272\u732b|\u6843\u82b1|\u9999\u8549|\u5976\u9999|\u9ed1\u6599|\u7cbe\u54c1|\u65e0\u7801|\u7121\u78bc|\u4e71\u4f26|\u4e82\u502b|\u798f\u5229|\u4e3b\u64ad|\u5f3a\u5978|\u841d\u8389|\u863f\u8389|\u5236\u670d|\u4f26\u7406|\u502b\u7406|\u6deb|\u91cc\u756a|\u91cc\u756a\u52a8\u6f2b|\u91cc\u756a\u52d5\u6f2b|\u65e5\u672c\u6709\u7801|\u65e5\u672c\u7121\u78bc|\u65e5\u672c\u65e0\u7801|\u4e2d\u6587\u5b57\u5e55|\u56fd\u4ea7\u81ea\u62cd|\u570b\u7522\u81ea\u62cd|\u5077\u62cd|\u5ad6\u5993|\u5b66\u751f\u59b9|\u5b78\u751f\u59b9|\u4eba\u59bb|\u98ce\u4fd7|\u98a8\u4fd7|\u4e09\u7ea7|\u4e09\u7d1a|AI\u6362\u8138|AI\u63db\u81c9|\bAV\b/i;

function nestedUrl(value) {
  try {
    return new URL(String(value || '')).searchParams.get('url') || '';
  } catch {
    return '';
  }
}

function isAdultSite(site) {
  const identityText = [site.key, site.name, site.api, site.ext, nestedUrl(site.api), nestedUrl(site.ext)]
    .map((value) => String(value || ''))
    .join(' ');
  if (ADULT_SITE_IDENTITY_RE.test(identityText)) return true;
  const categories = Array.isArray(site.categories) ? site.categories : [];
  if (!categories.length) return false;
  const matches = categories.filter((category) => ADULT_CATEGORY_RE.test(String(category || ''))).length;
  return matches >= 3 && matches / categories.length >= 0.35;
}

function adultName(name) {
  return /^\s*\uD83D\uDD1E/u.test(name) ? name : `\uD83D\uDD1E ${name}`;
}

function isIqiyiVodSite(key, api) {
  return key === '\u7231\u5947\u827a' || IQIYI_API_RE.test(api);
}

function normalizeSite(site, index) {
  const key = trimString(site.key || site.name || `vod-${index + 1}`);
  const adult = Boolean(site.adult || isAdultSite(site));
  const name = adult ? adultName(trimString(site.name || key)) : trimString(site.name || key);
  const api = trimString(site.api);
  const ext = trimString(site.ext);
  const categories = normalizeTvboxCategories(site.categories, adult);

  const normalized = {
    key,
    name,
    type: normalizeInt(site.type, 1),
    api,
    searchable: normalizeInt(site.searchable, 1),
    quickSearch: normalizeInt(site.quickSearch, 1),
    filterable: normalizeInt(site.filterable, 1),
  };

  if (ext) normalized.ext = ext;
  if (categories) normalized.categories = categories;
  if (adult) normalized.adult = true;
  if (site.changeable !== undefined) normalized.changeable = normalizeInt(site.changeable, site.changeable);
  if (site.playerType !== undefined) normalized.playerType = normalizeInt(site.playerType, site.playerType);
  if (site.timeout !== undefined) normalized.timeout = normalizeInt(site.timeout, site.timeout);

  if (!adult && isIqiyiVodSite(key, api)) {
    normalized.type = 3;
    normalized.api = IQIYI_RECOMMEND_JS_API;
    normalized.ext = api || IQIYI_ORIGIN_API;
    normalized.categories = IQIYI_TVBOX_CATEGORIES;
  }

  return normalized;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

const source = await readJson(input);
const sourceSites = Array.isArray(source) ? source : normalizeList(source.sites);
const warningText =
  trimString(source.warningText).replace(/every\s+\d+\s+days/i, 'daily at 02:00') ||
  'OKTV TVBox on-demand sources. Auto refreshed daily at 02:00.';
const seenKeys = new Set();
const sites = [];

for (const sourceSite of sourceSites) {
  const site = normalizeSite(sourceSite, sites.length);
  if (EXCLUDED_TVBOX_SOURCE_KEYS.has(site.key)) continue;
  if (!site.key || !site.api || seenKeys.has(site.key)) continue;
  seenKeys.add(site.key);
  sites.push(site);
}

const tvbox = {
  spider: trimString(source.spider),
  logo:
    trimString(source.logo) ||
    'https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png',
  wallpaper: trimString(source.wallpaper) || 'http://tool.teyonds.com/api',
  warningText,
  sites,
  parses: normalizeList(source.parses),
  lives: normalizeList(source.lives),
  ads: normalizeList(source.ads),
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(tvbox, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      output,
      input,
      sites: sites.length,
      parses: tvbox.parses.length,
      lives: tvbox.lives.length,
      ads: tvbox.ads.length,
    },
    null,
    2,
  ),
);

// Reviewed public sources only. A repository's list license is not a media license.
export const blenderMovies = [
  ['3eb93cab-79a2-4fd5-a636-d42e5c59ddea', 'HERO', 2018],
  ['1ba07bbb-1456-4293-99a6-833fa450eda0', 'SINGULARITY', 2026],
  ['3d95fb3d-c866-42c8-9db1-fe82f48ccb95', 'Spring', 2019],
  ['6402b77c-b61f-4a06-96ca-c8420a2becf4', 'Big Buck Bunny（60fps 版本）', 2008],
  ['f507dfdc-e73e-45a4-9778-d758cbe1ce96', 'Cosmos Laundromat', 2015],
  ['64222c8a-c4c7-4b3b-9850-7fb2078edcf6', 'Glass Half', 2015],
  ['23f3ef79-15dc-44c5-aa45-cf92e78a4509', 'Caminandes 3: Llamigos', 2016],
  ['7b2eff2a-35f2-4403-9d88-d0dd6e4b5ba1', 'The Daily Dweebs', 2017],
  ['ff8fe61b-026f-4f07-b66b-2a790d6f6ab1', 'Coffee Run', 2020, { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', evidence: 'https://studio.blender.org/projects/coffee-run/pages/licensing/' }],
  ['a69d68a5-a0e0-4a80-9d66-49f093c97aaf', 'Sprite Fright', 2021, { label: 'CC BY（版本依官方授權頁）', url: 'https://studio.blender.org/projects/sprite-fright/pages/about/', evidence: 'https://studio.blender.org/projects/sprite-fright/pages/about/' }],
  ['8533ea43-4271-4a57-9694-e9d0b35e1aa1', 'Tears of Steel', 2012, { label: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/', evidence: 'https://video.blender.org/videos/watch/8533ea43-4271-4a57-9694-e9d0b35e1aa1' }],
];

export const discovery = { repository: 'https://github.com/iptv-org/iptv', revision: '18150d85f81863651765665fcd80b7c0317f4fce', api: 'https://iptv-org.github.io/api/streams.json' };
export const officialLives = [
  ...[['102', '2015525', '英語'], ['103', '2015526', '阿拉伯語'], ['104', '2015530', '西班牙語'], ['110', '2017971', '俄語']].map(([stream, event, language]) => ({
    id: `public-dw-${stream}`, name: `DW ${language}｜官方串流`,
    url: `https://dwamdstream${stream}.akamaized.net/hls/live/${event}/dwstream${stream}/master.m3u8`, pageUrl: 'https://www.dw.com/en/live-tv/s-100825',
  })),
  ...[['AR', '阿拉伯語', '2037222'], ['EN', '英語', '2037218'], ['FR', '法語', '2037179'], ['ES', '西班牙語', '2037220']].map(([feed, label, number]) => ({
    id: `public-france24-${feed.toLowerCase()}`, name: `France 24 ${label}｜官方串流`,
    url: `https://live.france24.com/hls/live/${number}-b/F24_${feed}_HI_HLS/master_5000.m3u8`, pageUrl: 'https://www.france24.com/en/live',
  })),
  { id: 'public-cgtn-en', name: 'CGTN 英語｜官方串流', url: 'https://english-livebkali.cgtn.com/live/encgtn.m3u8', pageUrl: 'https://www.cgtn.com/tv' },
  { id: 'public-nhkworld-en', name: 'NHK WORLD JAPAN｜官方串流', url: 'https://masterpl.hls.nhkworld.jp/hls/w/live/smarttv.m3u8', pageUrl: 'https://www3.nhk.or.jp/nhkworld/en/live/' },
  { id: 'public-arirang-world', name: 'Arirang TV｜官方串流', url: 'https://amdlive-ch02-ctnd-com.akamaized.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8', pageUrl: 'https://www.arirang.com/' },
  { id: 'public-arirang-un', name: 'Arirang UN｜官方串流', url: 'https://amdlive-ch02-ctnd-com.akamaized.net/arirang_2ch/smil:arirang_2ch.smil/playlist.m3u8', pageUrl: 'https://www.arirang.com/' },
  { id: 'public-trtworld', name: 'TRT World｜官方串流', url: 'https://tv-trtworld.medya.trt.com.tr/master.m3u8', pageUrl: 'https://www.trtworld.com/live', availability: '依原頻道開播時段提供' },
];

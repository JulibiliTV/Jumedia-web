// Mirrors Juli's `ContentCategory.Kind` (region IDs and PGC feed names) and
// `RankingCategory.defaults`.

export interface Channel { kind: string; title: string; icon: string; regionIDs?: number[]; pgc?: string; seasonType?: number }

export const CHANNELS: Channel[] = [
  { kind: 'anime', title: '番剧', icon: 'tv', pgc: 'anime', seasonType: 1 },
  { kind: 'guochuang', title: '国创', icon: 'sparkle', pgc: 'guochuang', seasonType: 4 },
  { kind: 'documentary', title: '纪录片', icon: 'globe', pgc: 'documentary', seasonType: 3 },
  { kind: 'film', title: '电影', icon: 'film', pgc: 'movie', seasonType: 2 },
  { kind: 'tv', title: '电视剧', icon: 'tv', pgc: 'tv', seasonType: 5 },
  { kind: 'variety', title: '综艺', icon: 'star', pgc: 'variety', seasonType: 7 },
  { kind: 'animation', title: '动画', icon: 'sparkle', regionIDs: [1005] },
  { kind: 'gaming', title: '游戏', icon: 'grid', regionIDs: [1008] },
  { kind: 'kichiku', title: '鬼畜', icon: 'volume', regionIDs: [1007] },
  { kind: 'music', title: '音乐', icon: 'volume', regionIDs: [1003] },
  { kind: 'dance', title: '舞蹈', icon: 'users', regionIDs: [1004] },
  { kind: 'movie', title: '影视', icon: 'film', regionIDs: [1001] },
  { kind: 'entertainment', title: '娱乐', icon: 'star', regionIDs: [1002] },
  { kind: 'knowledge', title: '知识', icon: 'layers', regionIDs: [1010] },
  { kind: 'technology', title: '科技数码', icon: 'box', regionIDs: [1012] },
  { kind: 'life', title: '生活', icon: 'home', regionIDs: [1030, 1031] },
  { kind: 'food', title: '美食', icon: 'heart', regionIDs: [1020] },
  { kind: 'car', title: '汽车', icon: 'speed', regionIDs: [1013] },
  { kind: 'fashion', title: '时尚美妆', icon: 'tag', regionIDs: [1014] },
  { kind: 'sports', title: '体育运动', icon: 'flag', regionIDs: [1018] },
  { kind: 'animal', title: '动物', icon: 'heart', regionIDs: [1024] },
]

export const RANKINGS = [
  { id: 'all', title: '全站', rid: 0 },
  { id: 'anime', title: '番剧', seasonType: 1 },
  { id: 'guochuang', title: '国创', seasonType: 4 },
  { id: 'documentary', title: '纪录片', seasonType: 3 },
  { id: 'movie', title: '电影', seasonType: 2 },
  { id: 'tv', title: '电视剧', seasonType: 5 },
  { id: 'variety', title: '综艺', seasonType: 7 },
  { id: 'animation', title: '动画', rid: 1005 },
  { id: 'game', title: '游戏', rid: 1008 },
  { id: 'kichiku', title: '鬼畜', rid: 1007 },
  { id: 'music', title: '音乐', rid: 1003 },
  { id: 'dance', title: '舞蹈', rid: 1004 },
  { id: 'cinephile', title: '影视', rid: 1001 },
  { id: 'entertainment', title: '娱乐', rid: 1002 },
  { id: 'knowledge', title: '知识', rid: 1010 },
  { id: 'technology', title: '科技数码', rid: 1012 },
  { id: 'food', title: '美食', rid: 1020 },
  { id: 'car', title: '汽车', rid: 1013 },
  { id: 'fashion', title: '时尚美妆', rid: 1014 },
  { id: 'sports', title: '体育运动', rid: 1018 },
  { id: 'animal', title: '动物', rid: 1024 },
] as { id: string; title: string; rid?: number; seasonType?: number }[]

/** Juli's `BangumiWatchStatus`: 1 想看, 2 在看, 3 看过. */
export const WATCH_STATUS = [{ value: 1, label: '想看' }, { value: 2, label: '在看' }, { value: 3, label: '看过' }]

export const SEASON_TYPES = [{ value: 1, label: '番剧' }, { value: 4, label: '国创' }, { value: 2, label: '电影' }, { value: 3, label: '纪录片' }, { value: 5, label: '电视剧' }, { value: 7, label: '综艺' }]

export const sourceNames = { emby: 'Emby', jellyfin: 'Jellyfin', fntv: '飞牛影视' } as const
export type SourceType = keyof typeof sourceNames

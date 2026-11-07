export const sourceNames = { emby: 'Emby', jellyfin: 'Jellyfin' } as const
export type SourceType = keyof typeof sourceNames

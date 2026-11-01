/** Admin previews receive stored media references; `idb:` and `emby:` refs only exist in the in-browser mock. */
export async function resolveAssetURL(ref: string): Promise<string> {
  if (!ref.startsWith('idb:') && !ref.startsWith('emby:')) return ref
  const { resolveMedia } = await import('../mock/db')
  return resolveMedia(ref)
}

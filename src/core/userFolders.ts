import type { Platform } from './platform'

/**
 * A content ini value can name a folder of the player's Windows profile with `{Pictures}`, which is resolved where the value is
 * written: the folder is the player's, so no published file can hold it. Windows says where it is, so a profile that
 * redirects Pictures (OneDrive, another drive) is followed. Used by ReShade's screenshot folder.
 */
export const USER_FOLDER_TOKEN = '{Pictures}'

export async function expandUserFolders(platform: Platform, value: string): Promise<string> {
  return value.includes(USER_FOLDER_TOKEN) ? value.split(USER_FOLDER_TOKEN).join(await platform.envFolder('Pictures')) : value
}

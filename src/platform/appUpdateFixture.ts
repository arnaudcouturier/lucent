// Inert app releases for tests and the browser gallery. Never an executable download.
import { APP_RELEASES_URL } from '../core/appUpdate'
import { FAKE_EXE_PATH, type Machine } from './fake'

export const APP_EXE_TEXT = 'Lucent 0.2.0'
export const APP_EXE_HASH = '260858470312c0564b0aa1dc395e548e4f3a1f76dfc47e260336c98a2a752a5a'
export const APP_EXE_URL = 'https://github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'
export const APP_RELEASE = {
  tag_name: 'app-v0.2.0', draft: false, prerelease: false,
  body: 'Faster startup.\nClearer errors.',
  assets: [{ name: 'Lucent.exe', browser_download_url: APP_EXE_URL, digest: `sha256:${APP_EXE_HASH}`, size: 12 }],
}

export const appReleaseHost = (): Machine => ({
  files: { [FAKE_EXE_PATH]: 'Lucent 0.1.0' },
  remoteText: { [APP_RELEASES_URL]: JSON.stringify([APP_RELEASE]), [APP_EXE_URL]: APP_EXE_TEXT },
})

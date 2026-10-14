// Inert app releases for tests and the browser gallery. Never an executable download.
import { APP_RELEASES_URL } from '../core/appUpdate'
import { FAKE_EXE_PATH, type Machine } from './fake'

export const APP_EXE_TEXT = 'Lucent 0.2.0'
export const APP_EXE_HASH = '260858470312c0564b0aa1dc395e548e4f3a1f76dfc47e260336c98a2a752a5a'
export const APP_EXE_URL = 'https://github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0/Lucent.exe'
export const APP_BETA_EXE_TEXT = 'Lucent 0.2.0-beta.2'
export const APP_BETA_EXE_HASH = '3997ba22bb8d6ccf5277d16de1d7ddb989ed01241db434f28922bc4ee55e8835'
export const APP_BETA_EXE_URL = 'https://github.com/arnaudcouturier/lucent/releases/download/app-v0.2.0-beta.2/Lucent.exe'
export const APP_RELEASE = {
  tag_name: 'app-v0.2.0', draft: false, prerelease: false,
  body: 'Faster startup.\nClearer errors.',
  assets: [{ name: 'Lucent.exe', browser_download_url: APP_EXE_URL, digest: `sha256:${APP_EXE_HASH}`, size: 12 }],
}

export const appReleaseHost = (): Machine => ({
  files: { [FAKE_EXE_PATH]: 'Lucent 0.1.0' },
  remoteText: { [APP_RELEASES_URL]: JSON.stringify([APP_RELEASE]), [APP_EXE_URL]: APP_EXE_TEXT },
})

/** A pre-release of the next app version; only the Beta channel is offered it. */
export const APP_BETA_RELEASE = {
  tag_name: 'app-v0.2.0-beta.2', draft: false, prerelease: true,
  body: 'Beta: faster startup.',
  assets: [{ name: 'Lucent.exe', browser_download_url: APP_BETA_EXE_URL, digest: `sha256:${APP_BETA_EXE_HASH}`, size: APP_BETA_EXE_TEXT.length }],
}

/** Only the pre-release is published, so Stable has nothing to announce. */
export const appBetaReleaseHost = (): Machine => ({
  files: { [FAKE_EXE_PATH]: 'Lucent 0.1.0' },
  remoteText: { [APP_RELEASES_URL]: JSON.stringify([APP_BETA_RELEASE]), [APP_BETA_EXE_URL]: APP_BETA_EXE_TEXT },
})

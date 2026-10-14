# Per-game Auto HDR registry value

Windows stores per-game graphics preferences as `REG_SZ` values named by the executable path under
`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. The string is a sequence of semicolon-terminated
preference tokens; a read-only value observed on this development machine was
`SwapEffectUpgradeEnable=257;GpuPreference=2;`.

The upstream [OneDragon Auto HDR implementation](https://github.com/OneDragon-Anything/ZenlessZoneZero-OneDragon/blob/main/src/zzz_od/operation/enter_game/auto_hdr.py)
reads and remembers the complete value, writes `AutoHDREnable=2096;` while disabling Auto HDR, and restores
the original string (or deletes the value when it was absent). This verifies the value name and the disable
token used by another Windows game manager. Microsoft documents `REG_SZ` as a null-terminated registry
string in its [registry value type reference](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-value-types).

Lucent owns only the `AutoHDREnable` token. It keeps the other tokens and their order, journals the exact
previous value or absence before writing, and restores only its token if another program changes the other
preferences afterwards. It writes the original player's loaded `HKEY_USERS\<SID>` hive so
an elevation prompt for another administrator account cannot redirect the change to that account's `HKCU`.

## When Lucent writes it

Only at deployment, as part of the first-install choices (scope reset, 2026-10-14). When the player picks HDR or
Scene HDR, the install journals one registry intent after its file steps, then disables Auto HDR for
`ffxiv_dx11.exe`. It reads the value first: when it is already disabled, nothing is journaled and nothing is
written. Picking Off, or having no HDR monitor, never touches the registry. The intent is durable before the
write, so recovery of an interrupted install and a failed install put the player's value back, and Uninstall
restores it from the journal when the player has not changed the token since. Uninstalling Lucent from
Settings → Apps with the game files kept restores it too. Nothing rewrites it on open, on launch or on
repair, and a later Reset decides again from the HDR mode it shows.

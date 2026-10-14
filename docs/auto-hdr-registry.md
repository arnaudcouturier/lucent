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
preferences while Lucent has HDR enabled. It writes the original player's loaded `HKEY_USERS\<SID>` hive so
an elevation prompt for another administrator account cannot redirect the change to that account's `HKCU`.

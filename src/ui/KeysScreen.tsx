// Every in-game key, read from the game folder's OptiScaler.ini and ReShade.ini each time the section opens, so a key
// someone changed in game and forgot shows here as it is now.
import { useEffect } from 'react'
import { useCore } from './useCore'
import { Screen } from './Window'
import { GuideLink, KeyBindingList } from './DeploymentScreens'

export function KeysScreen() {
  const [{ keybinds }, core] = useCore()
  useEffect(() => {
    void core.refreshKeybinds()
    // Coming back from the game after changing a key reads the files again.
    const onFocus = () => void core.refreshKeybinds()
    addEventListener('focus', onFocus)
    return () => removeEventListener('focus', onFocus)
  }, [core])
  return <Screen title="Keys" sub="Read from your game folder just now, including any key you changed in game.">
    {keybinds?.length ? <KeyBindingList bindings={keybinds} /> : <p className="screen-note">Lucent couldn’t read the keys from your game folder.</p>}
    <p className="screen-note">Change a key in game: OptiScaler menu → Keybinds, or ReShade menu → Settings.</p>
    <GuideLink>Each tool’s default keys are in the</GuideLink>
  </Screen>
}

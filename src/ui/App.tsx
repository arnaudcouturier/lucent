import { ScanScreen } from './ScanScreen'
import { Window, useSection } from './Window'
import { useCore, useGameRunningRefresh } from './useCore'
import { DoneScreen, InstallScreen, ReviewScreen } from './DeploymentScreens'
import { MainScreen } from './MainScreens'
import { ModsScreen } from './ModsScreen'
import { ProfileScreen } from './Profiles'

export function App() {
  const [, core] = useCore()
  useGameRunningRefresh(core)
  return (
    <Window>
      <Content />
    </Window>
  )
}

/** Mods stands apart from the DLSS 5 and ReShade setup, so it opens from the first-run steps too; only an install in progress keeps it away. */
function Content() {
  const [{ activity }] = useCore()
  const { section } = useSection()
  if (section === 'mods' && activity.kind !== 'deploying') return <ModsScreen />
  return activity.kind === 'profile' ? <ProfileScreen /> : activity.kind === 'review' ? <ReviewScreen /> : activity.kind === 'deploying' ? <InstallScreen /> : activity.kind === 'done' ? <DoneScreen /> : activity.kind === 'deployment' ? <MainScreen /> : <ScanScreen />
}

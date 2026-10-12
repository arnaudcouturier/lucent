import { ScanScreen } from './ScanScreen'
import { Window } from './Window'
import { useCore } from './useCore'
import { DoneScreen, InstallScreen, MainScreen, ReviewScreen } from './DeploymentScreens'
import { ProfileScreen } from './Profiles'

export function App() {
  const [{ activity }] = useCore()
  return (
    <Window>
      {activity.kind === 'profile' ? <ProfileScreen /> : activity.kind === 'review' ? <ReviewScreen /> : activity.kind === 'deploying' ? <InstallScreen /> : activity.kind === 'done' ? <DoneScreen /> : activity.kind === 'deployment' ? <MainScreen /> : <ScanScreen />}
    </Window>
  )
}

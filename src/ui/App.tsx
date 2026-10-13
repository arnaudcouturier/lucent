import { ScanScreen } from './ScanScreen'
import { Window } from './Window'
import { useCore } from './useCore'
import { DoneScreen, InstallScreen, MainScreen, ReviewScreen } from './DeploymentScreens'
import { ProfileScreen } from './Profiles'
import { useEffect } from 'react'

export function App() {
  const [{ activity }, core] = useCore()
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      await core.refreshGameRunning()
      if (!stopped) timer = setTimeout(() => void refresh(), 1000)
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [core])
  return (
    <Window>
      {activity.kind === 'profile' ? <ProfileScreen /> : activity.kind === 'review' ? <ReviewScreen /> : activity.kind === 'deploying' ? <InstallScreen /> : activity.kind === 'done' ? <DoneScreen /> : activity.kind === 'deployment' ? <MainScreen /> : <ScanScreen />}
    </Window>
  )
}

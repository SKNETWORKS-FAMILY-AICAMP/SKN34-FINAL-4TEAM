import { SafeAreaProvider } from 'react-native-safe-area-context'

import { WebShell } from './src/WebShell.tsx'

export default function App() {
  return (
    <SafeAreaProvider>
      <WebShell />
    </SafeAreaProvider>
  )
}

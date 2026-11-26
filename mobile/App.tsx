import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { WebShell } from './src/WebShell.tsx'

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root}>
        <WebShell />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#ffffff' } })

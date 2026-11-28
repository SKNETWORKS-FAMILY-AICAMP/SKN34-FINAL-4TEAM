import Constants from 'expo-constants'
import { randomUUID } from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { androidChannel } from './device.ts'
import { pushNoticeId, shouldRequestNotificationPermission } from './notification.ts'

const installationKey = 'storyfork.push-installation'
const remoteEnabled = Constants.expoConfig?.extra?.androidRemotePush === true
let installation: Promise<string> | undefined

function installationId() {
  installation ??= (async () => {
    const saved = pushNoticeId({ noticeId: await SecureStore.getItemAsync(installationKey) })
    if (saved) return saved
    const id = randomUUID()
    await SecureStore.setItemAsync(installationKey, id)
    return id
  })().catch(error => { installation = undefined; throw error })
  return installation
}

export function useAndroidPush(memberId: string | null, send: (installationId: string, token: string | null) => void) {
  const [active, setActive] = useState(AppState.currentState === 'active')
  const asked = useRef(false)
  const sync = useEffectEvent(send)

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android' || !memberId || !active) return
    let cancelled = false
    let rotation = 0
    let listener: ReturnType<typeof Notifications.addPushTokenListener> | undefined
    const report = () => { if (!cancelled) console.warn('Android 알림을 설정하지 못했어요.') }
    async function sendDevice(token: string | null, expectedRotation: number) {
      const id = await installationId()
      if (!cancelled && rotation === expectedRotation) sync(id, token)
    }

    void (async () => {
      await Notifications.setNotificationChannelAsync(androidChannel, { name: 'STORYFORK 알림', importance: Notifications.AndroidImportance.DEFAULT })
      let permission = await Notifications.getPermissionsAsync()
      if (!cancelled && shouldRequestNotificationPermission(permission, asked.current)) {
        asked.current = true
        permission = await Notifications.requestPermissionsAsync()
      }
      if (cancelled || !remoteEnabled) return
      if (!permission.granted) return sendDevice(null, rotation)
      listener = Notifications.addPushTokenListener(token => {
        if (token.type === 'android') void sendDevice(token.data, ++rotation).catch(report)
      })
      const expectedRotation = rotation
      const token = await Notifications.getDevicePushTokenAsync()
      if (token.type === 'android') await sendDevice(token.data, expectedRotation)
    })().catch(report)
    return () => { cancelled = true; listener?.remove() }
  }, [memberId, active])
}

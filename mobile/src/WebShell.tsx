import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'

import { BACKGROUND_SCRIPT, DEFAULT_LOOK, type Look, lookOf, palette } from './appearance.ts'
import { initialBridgeState, receive } from './bridge.ts'
import { API_BASE_URL, webUrl } from './config.ts'
import { requestNotificationPermission, showLocalNotification } from './device.ts'
import { TabBar } from './TabBar.tsx'
import { selectedTab } from './tabs.ts'
import { isSameOrigin, navigateScript, navigationDecision, tapDestination } from './webview.ts'

/**
 * 앱 화면 전부: STORYFORK 웹을 WebView로 보인다(로그인·알림함·설정·독서·집필 모두 웹 그대로, 로그인은 웹에서 한 번).
 * 앱이 하는 일은 알림과 하단 탭뿐이다: 웹이 브리지(postMessage)로 준 알림 목록에서 새 알림을 로컬 알림으로 띄우고, 알림을 누르면 그 웹 경로로 이동한다.
 * 하단 탭(홈·탐색·내 서재·알림·내 정보)은 웹의 해당 경로로 이동시키고, WebView의 현재 주소에 맞는 탭을 표시한다.
 * 화면 위아래는 앱이 채운다: 상태바 쪽 안전 영역은 WebView 밖의 불투명한 띠(웹 배경색)이고 WebView는 그 아래에서 시작하므로 웹 상단 바(sticky)가
 * 상태바를 가리거나 같이 끌려 내려오지 않으며, 아래쪽은 하단 탭이 홈 표시줄까지 채운다. 띠·탭·상태바 글자는 웹 테마(라이트·다크)를 따른다.
 * 쿠키(로그인 유지)는 WebView의 기본 저장소가 앱을 다시 켠 뒤에도 보관한다.
 */
export function WebShell() {
  const insets = useSafeAreaInsets()
  const tapped = Notifications.useLastNotificationResponse() // undefined: 확인 중, null: 없음
  // n은 같은 주소여도 WebView를 새로 열게 하는 값이다(알림을 다시 눌렀을 때·다시 시도).
  const [page, setPage] = useState<{ uri: string; n: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [url, setUrl] = useState<string | null>(null) // WebView의 현재 주소(선택할 탭을 정한다)
  const [look, setLook] = useState<Look>(DEFAULT_LOOK) // 웹 배경색(상태바 띠)과 어두운지(상태바 글자·탭 색)
  // react-native-webview 14의 타입은 제네릭 기본값(undefined)이 props를 never로 만들어 WebView<unknown>으로 쓴다.
  const web = useRef<WebView<unknown>>(null)
  const canGoBack = useRef(false)
  const bridge = useRef(initialBridgeState)
  const asked = useRef(false)

  // 시작 주소: 알림을 눌러 앱이 열렸으면 그 대상, 아니면 웹 홈. 이후 알림을 누를 때마다 그 대상으로 새로 연다.
  useEffect(() => {
    if (tapped === undefined) return
    const url = tapped?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ? tapDestination(tapped.notification.request.content.data) : null
    setPage((current) => (url || !current ? { uri: url ?? webUrl('/'), n: (current?.n ?? 0) + 1 } : current))
    setFailed(false)
  }, [tapped])

  // Android 하드웨어 뒤로 = WebView 뒤로(갈 곳이 없으면 앱을 닫는다).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false
      web.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [])

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    if (!isSameOrigin(nativeEvent.url)) return // 우리 웹이 보낸 메시지만 받는다
    const next = lookOf(nativeEvent.data)
    if (next) { setLook((current) => (current.background === next.background ? current : next)); return }
    const { state, fresh } = receive(bridge.current, nativeEvent.data)
    bridge.current = state
    // 알림 권한은 로그인한 걸 안 뒤 한 번만 묻는다(iOS는 이미 정했으면 창 없이 현재 상태만 돌려준다).
    if (state.userId && !asked.current) { asked.current = true; requestNotificationPermission().catch(() => {}) }
    fresh.forEach((n) => showLocalNotification(n).catch(() => {}))
  }

  // 다른 origin 링크는 WebView에서 열지 않고 시스템 브라우저로 보낸다. iframe 같은 하위 프레임은 거르지 않는다.
  const onShouldStart = (request: ShouldStartLoadRequest) => {
    if (!request.isTopFrame) return true
    const decision = navigationDecision(request.url)
    if (decision === 'external') Linking.openURL(request.url).catch(() => {})
    return decision === 'allow'
  }

  // 탭: WebView가 떠 있으면 페이지를 새로 읽지 않고 웹 라우터로 이동하고(주소 기록도 쌓인다), 오류 화면이거나 아직 없으면 그 주소로 새로 연다.
  const openTab = (path: string) => {
    if (web.current) { web.current.injectJavaScript(navigateScript(path)); return }
    setPage((current) => ({ uri: webUrl(path), n: (current?.n ?? 0) + 1 }))
    setFailed(false)
  }

  const content = !page ? null
    : failed ? <LoadError look={look} onRetry={() => { setFailed(false); setPage({ ...page, n: page.n + 1 }) }} />
    : (
      <WebView<unknown>
        key={page.n}
        ref={web}
        source={{ uri: page.uri }}
        style={styles.web}
        allowsBackForwardNavigationGestures
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        overScrollMode="never"
        injectedJavaScript={BACKGROUND_SCRIPT}
        startInLoadingState
        renderLoading={() => <View style={[styles.center, { backgroundColor: look.background }]}><ActivityIndicator /></View>}
        onShouldStartLoadWithRequest={onShouldStart}
        onNavigationStateChange={(navigation) => { canGoBack.current = navigation.canGoBack; setUrl(navigation.url) }}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onHttpError={({ nativeEvent }) => { if (nativeEvent.statusCode >= 500) setFailed(true) }}
      />
    )

  return (
    <View style={[styles.root, { backgroundColor: look.background }]}>
      <StatusBar style={look.dark ? 'light' : 'dark'} />
      <View style={{ height: insets.top }} />
      <View style={styles.content}>{content}</View>
      <TabBar selected={url ? selectedTab(url) : null} dark={look.dark} onSelect={openTab} />
    </View>
  )
}

/** 서버가 꺼졌거나 연결이 안 될 때 빈 화면으로 두지 않고 알리며 다시 시도하게 한다. */
function LoadError({ look, onRetry }: { look: Look; onRetry: () => void }) {
  const colors = palette(look.dark)
  return (
    <View style={[styles.center, { backgroundColor: look.background }]} accessibilityRole="alert">
      <Text style={[styles.title, { color: colors.ink }]}>STORYFORK에 연결하지 못했어요</Text>
      <Text style={[styles.detail, { color: colors.sub }]}>{API_BASE_URL}</Text>
      <Text style={[styles.detail, { color: colors.sub }]}>서버가 켜져 있는지, 네트워크가 연결돼 있는지 확인해 주세요.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { backgroundColor: colors.pri }, pressed && styles.pressed]}>
        <Text style={[styles.retryText, { color: colors.onPri }]}>다시 시도</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' }, // 페이지가 그려지기 전에는 뒤의 웹 배경색이 보인다
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  detail: { fontSize: 14, textAlign: 'center' },
  retry: { minHeight: 44, minWidth: 120, marginTop: 8, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.75 },
})

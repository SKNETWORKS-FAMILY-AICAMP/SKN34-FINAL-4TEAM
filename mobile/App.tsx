import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Button, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { clearInbox, newNotices, noticeId, parseWebMessage, trustedPage } from './noticeBridge';

const channel = 'storyfork';
const installationKey = 'storyfork.push-installation';
const config = Constants.expoConfig?.extra;
const remoteEnabled = Platform.OS === 'android' && config?.androidRemotePush === true;
let installation: Promise<string> | undefined;

function installationId() {
  installation ??= (async () => {
    const saved = await SecureStore.getItemAsync(installationKey);
    if (noticeId(saved)) return saved;
    const id = randomUUID();
    await SecureStore.setItemAsync(installationKey, id);
    return id;
  })().catch(error => { installation = undefined; throw error; });
  return installation;
}

Notifications.setNotificationHandler({
  handleNotification: async ({ request }) => {
    // 전면에서는 WebView의 같은 사건이 로컬 알림을 만든다.
    const local = request.content.data?.source === 'storyfork-web';
    return { shouldShowBanner: local, shouldShowList: local, shouldPlaySound: false, shouldSetBadge: false };
  },
});

function webAddress() {
  try {
    const url = new URL(config?.webUrl ?? '');
    const emulator = __DEV__ && url.protocol === 'http:' && ['10.0.2.2', 'localhost', '127.0.0.1'].includes(url.hostname);
    if (!url.username && !url.password && (url.protocol === 'https:' || emulator)) return url;
  } catch { /* 설정 화면에서 필요한 주소를 안내한다. */ }
  return null;
}

const address = webAddress();
type NativeMessage = { type: 'storyfork.tap'; id: string } |
  { type: 'storyfork.device'; installationId: string; token: string | null };

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.page}>
        <StatusBar style="dark" />
        {address ? <StoryforkWeb source={address.href} origin={address.origin} /> : (
          <View style={styles.message}>
            <Text accessibilityRole="header" style={styles.heading}>STORYFORK</Text>
            <Text>앱에서 열 STORYFORK 웹 주소가 필요해요. 빌드 설정의 MOBILE_WEB_URL을 확인해 주세요.</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function StoryforkWeb({ source, origin }: { source: string; origin: string }) {
  const web = useRef<WebView<object>>(null);
  const back = useRef(false);
  const inbox = useRef(clearInbox());
  const pending = useRef<string | null>(null);
  const accountRef = useRef<string | null>(null);
  const pageReady = useRef(false);
  const [account, setAccount] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  function send(message: NativeMessage) {
    web.current?.injectJavaScript(`if (location.origin === ${JSON.stringify(origin)}) window.dispatchEvent(new CustomEvent('storyfork:mobile', {detail:${JSON.stringify(message)}})); true;`);
  }

  function openPending() {
    if (!pageReady.current || !accountRef.current || !pending.current) return;
    send({ type: 'storyfork.tap', id: pending.current });
    pending.current = null;
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    const backPress = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!back.current) return false;
      web.current?.goBack();
      return true;
    });
    let previous: string | undefined;
    const clicked = (response: Notifications.NotificationResponse | null) => {
      const request = response?.notification.request;
      if (!request || request.identifier === previous || !noticeId(request.content.data?.noticeId)) return;
      previous = request.identifier;
      pending.current = request.content.data.noticeId;
      Notifications.clearLastNotificationResponse();
      openPending();
    };
    const notificationTap = Notifications.addNotificationResponseReceivedListener(clicked);
    clicked(Notifications.getLastNotificationResponse());
    return () => { subscription.remove(); backPress.remove(); notificationTap.remove(); };
  }, [origin]);

  useEffect(() => {
    if (!account || !active) return;
    let cancelled = false;
    let rotation = 0;
    let listener: ReturnType<typeof Notifications.addPushTokenListener> | undefined;
    async function sendDevice(token: string | null, expectedRotation: number) {
      const id = await installationId();
      if (!cancelled && pageReady.current && accountRef.current === account && rotation === expectedRotation) {
        send({ type: 'storyfork.device', installationId: id, token });
      }
    }
    const report = () => { if (!cancelled) console.warn('알림 설정을 적용하지 못했어요. 앱으로 다시 돌아오면 재시도해요.'); };
    void (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(channel, { name: 'STORYFORK 알림', importance: Notifications.AndroidImportance.DEFAULT });
      }
      let permission = await Notifications.getPermissionsAsync();
      if (permission.status === 'undetermined' && !cancelled) permission = await Notifications.requestPermissionsAsync();
      if (cancelled || !remoteEnabled) return;
      if (!permission.granted) return sendDevice(null, rotation);
      listener = Notifications.addPushTokenListener(token => {
        if (token.type === 'android') void sendDevice(token.data, ++rotation).catch(report);
      });
      const expectedRotation = rotation;
      const token = await Notifications.getDevicePushTokenAsync();
      if (token.type === 'android') await sendDevice(token.data, expectedRotation);
    })().catch(report);
    return () => { cancelled = true; listener?.remove(); };
  }, [account, active, origin]);

  function onMessage({ nativeEvent }: WebViewMessageEvent) {
    if (!trustedPage(origin, nativeEvent.url)) return;
    const message = parseWebMessage(nativeEvent.data);
    if (!message) return;
    if (message.type === 'storyfork.ready') {
      if (accountRef.current !== message.account) inbox.current = clearInbox();
      if (accountRef.current && accountRef.current !== message.account) {
        pending.current = null;
        void Notifications.dismissAllNotificationsAsync().catch(() => {});
      }
      accountRef.current = message.account;
      pageReady.current = true;
      setAccount(message.account);
      openPending();
    } else if (pageReady.current && accountRef.current) {
      const notices = newNotices(inbox.current, message.items);
      if (AppState.currentState !== 'active') return;
      for (const notice of notices) {
        void Notifications.scheduleNotificationAsync({
          content: { title: 'STORYFORK', body: notice.summary, data: { noticeId: notice.id, source: 'storyfork-web' } },
          trigger: null,
        }).catch(() => console.warn('STORYFORK 로컬 알림을 표시하지 못했어요.'));
      }
    }
  }

  function allowNavigation(url: string) {
    if (trustedPage(origin, url)) return true;
    if (url.startsWith('https://')) void Linking.openURL(url).catch(() => {});
    return false;
  }

  return (
    <>
      <WebView<object>
        ref={web}
        source={{ uri: source }}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={({ url, isTopFrame }) => isTopFrame === false ? trustedPage(origin, url) : allowNavigation(url)}
        onOpenWindow={({ nativeEvent }) => { if (allowNavigation(nativeEvent.targetUrl)) web.current?.injectJavaScript(`location.assign(${JSON.stringify(nativeEvent.targetUrl)}); true;`); }}
        onNavigationStateChange={state => { back.current = state.canGoBack; }}
        onLoadStart={() => {
          pageReady.current = false;
          setAccount(null);
          inbox.current = clearInbox();
        }}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onHttpError={({ nativeEvent }) => { if (trustedPage(origin, nativeEvent.url)) setFailed(true); }}
        webviewDebuggingEnabled={__DEV__}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows
        allowFileAccess={false}
        mixedContentMode="never"
      />
      {failed && (
        <View style={[styles.message, StyleSheet.absoluteFill]}>
          <Text accessibilityRole="header" style={styles.heading}>STORYFORK에 연결할 수 없어요</Text>
          <Button title="다시 연결" onPress={() => { setFailed(false); web.current?.reload(); }} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  message: { flex: 1, justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#fff' },
  heading: { fontSize: 24, fontWeight: '700' },
});

# STORYFORK 모바일 앱 (`mobile/`)

Android·iOS를 한 코드로 만드는 Expo(React Native, TypeScript) 앱입니다. Expo SDK 58·React Native 0.88·React 19.3입니다. 진행은 [#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943)입니다.

## 앱이 하는 일

앱을 열면 로그인 화면이 아니라 바로 **STORYFORK 웹이 전체 화면 WebView로** 뜹니다. 로그인·회원가입·알림함·알림 설정·독서·집필은 모두 웹 화면 그대로이고 로그인은 웹에서 한 번만 합니다. 앱이 직접 하는 일은 알림과 하단 탭뿐이며 네이티브 로그인·알림함·설정 화면과 네이티브 인증·API 클라이언트는 없습니다. 공개 `/api`는 웹 화면이 부르고 앱은 AI·DB를 직접 호출하지 않습니다([아키텍처](../docs/architecture.md)).

- **WebView:** 시작 주소는 웹 origin(`EXPO_PUBLIC_API_BASE_URL`)입니다. safe area를 지키고, iOS는 뒤로·앞으로 스와이프, Android는 하드웨어 뒤로 = WebView 뒤로(갈 곳이 없으면 앱 종료)입니다. 같은 origin만 앱 안에서 열고 다른 origin의 http(s)·mailto·tel 링크는 시스템 브라우저·메일·전화로 보내며 그 밖의 scheme(javascript·file 등)은 열지 않습니다. 로딩에 실패하면(서버 꺼짐 등) 빈 화면 대신 오류 안내와 `다시 시도`를 보입니다.
- **하단 탭·전체 화면:** 앱이 하단 탭 5개(홈·탐색·내 서재·알림·내 정보 → 웹 `/`·`/search`·`/lib`·`/notifications`·`/me/profile`)를 그리고, 누르면 페이지를 새로 읽지 않고 웹 라우터로 이동합니다(주소 기록이 쌓여 뒤로 스와이프가 동작하고, WebView의 현재 주소에 맞는 탭이 선택 표시됩니다). 상태바 쪽 안전 영역은 WebView 밖의 불투명한 띠로 웹 배경색을 따라 칠하고(앱이 주입한 스크립트가 웹 body 배경색을 읽어 알려 주므로 다크 테마 전환·상태바 글자 색·하단 탭 색도 따라갑니다) WebView는 그 아래에서 시작하며 위아래 바운스를 꺼 웹 상단 바가 상태바를 가리거나 끌려 내려오지 않습니다. 하단 탭은 홈 표시줄 영역까지 채웁니다. 웹 코드는 바꾸지 않습니다.
- **로그인 유지:** 웹의 갱신 토큰(HttpOnly `refresh_token` 쿠키)을 WebView(iOS는 WKWebView의 기본 저장소)가 보관해 앱을 다시 켜도 웹이 세션을 복구합니다.
- **알림(브리지):** 웹은 앱 안에서만(`window.ReactNativeWebView`가 있을 때) 알림 목록 첫 쪽을 읽을 때마다 `postMessage`로 앱에 알립니다(로그아웃·계정 전환 때는 로그아웃 메시지). 앱은 zod로 검증하고 기준선 이후 새로 생긴 읽지 않은 알림만 `expo-notifications` **로컬 알림**으로 띄웁니다(앱이 foreground여도 배너). 처음 받은 목록·로그아웃 뒤·다른 계정으로 바뀐 뒤 처음 목록은 기준선만 만듭니다. 형식과 규칙은 [알림 계약](../docs/notification-event-contract.md#모바일-앱-webview-브리지-메시지)에 있습니다. 알림 권한은 로그인한 것을 안 뒤(첫 알림 목록을 받을 때) 한 번 요청합니다. 앱을 내리거나 종료하면 오지 않습니다: iOS는 유료 계정이 없어 APNs 원격 푸시를 쓰지 않습니다.
- **알림 탭 이동:** 로컬 알림과 `xcrun simctl push` 알림을 누르면 WebView가 웹 `noticeTarget`과 같은 규칙(`src/notification.ts`, 웹 테스트와 같은 기대값을 `src/notification.test.ts`가 확인)의 같은 origin 경로로 이동합니다. 앱이 종료된 상태에서 눌러 시작해도 그 경로로 엽니다.

## 실행

Node 22.13+·24.3+·26+(React Native 0.88의 `engines`)와 npm이 필요합니다(검증: Node 22.22). iOS는 macOS의 Xcode·CocoaPods, Android는 Android Studio(SDK·에뮬레이터)를 씁니다.

```bash
cd mobile
npm install
npx expo run:ios      # iOS 시뮬레이터에 개발 빌드를 설치·실행 (예: --device "iPhone 17 Pro")
npx expo run:android  # Android 에뮬레이터·기기에 개발 빌드를 설치·실행
npx tsc --noEmit      # 타입 검사
npm test              # 단위 테스트(node --test)
```

`ios/`·`android/`는 Expo가 `app.json`으로 생성하는 폴더라 커밋하지 않습니다(`.gitignore`). 네이티브 코드 수정이 필요하면 `npx expo prebuild`로 꺼냅니다.
앱 식별자는 iOS `bundleIdentifier`·Android `package` 모두 `com.storyfork.app`, 링크 scheme은 `storyfork`입니다.
앱 아이콘은 웹 `frontend/public/favicon.svg`의 브랜드 마크(보라 `#6D4AE0` 바탕에 흰 `SF`, -6° 회전)로 만든 `assets/`의 PNG이고(`icon.png`는 iOS가 모서리를 깎으므로 끝까지 채운 알파 없는 1024px, Android 전경·모노크롬은 안전 영역 66% 안), `app.json`이 가리킵니다. 아이콘을 바꾼 뒤에는 `npx expo prebuild --platform ios --no-install`로 반영하는데, 이 명령은 생성 폴더 `ios/`를 지우고 다시 만들므로 `Pods`도 사라져 다음 `npx expo run:ios`가 `pod install`부터 전체를 다시 빌드합니다. 스플래시는 `expo-splash-screen` 플러그인을 쓰지 않아 아직 설정이 없습니다(시작 화면은 흰색).
`google-services.json`·`GoogleService-Info.plist`·`.env*`는 커밋하지 않습니다(설정은 루트 `.env` 하나).
`expo run:ios`가 마지막에 `System Events` 오류(-1743)로 exit 1이어도 빌드·설치는 끝난 것입니다. 이때는 `npx expo start --port <빈 포트>`로 Metro를 띄우고 `xcrun simctl launch booted com.storyfork.app`으로 실행합니다(빌드할 때 쓴 `--port`로 맞춥니다).

### 웹 주소

`EXPO_PUBLIC_API_BASE_URL`(비밀이 아니며 번들에 들어갑니다)이 앱이 여는 웹의 주소입니다. 값이 없거나 비어 있으면 로컬 Compose의 web nginx `http://localhost:5173`이고, iOS 시뮬레이터에서는 호스트의 localhost가 그대로 통합니다. 값은 번들 시점에 박히므로 바꾸면 `npx expo start --clear`로 다시 띄웁니다.

- 웹이 Web Locks(`navigator.locks`)로 로그인 갱신을 조율해 **보안 컨텍스트(https 또는 localhost)** 에서만 로그인됩니다. Android 에뮬레이터의 `http://10.0.2.2:5173`은 보안 컨텍스트가 아니라서 `adb reverse tcp:5173 tcp:5173`으로 `http://localhost:5173`을 쓰거나 https 서버를 씁니다.
- localhost·로컬 네트워크가 아닌 서버는 https여야 합니다(iOS ATS, http는 Expo 템플릿 Info.plist의 `NSAllowsLocalNetworking`만 허용).
- 웹을 로컬 Vite 개발 서버로 확인하려면 그 주소를 이 변수로 줍니다(Core의 CORS 허용 origin과 맞아야 POST가 통과합니다).

### 알림 확인용 `simctl push`

```bash
xcrun simctl push booted com.storyfork.app push-example.apns   # mobile/ 에서 실행
```

알림 권한을 허용한 앱에 배너가 뜨고 누르면 WebView가 `/work/<id>` 웹 경로로 이동합니다. 원격 알림의 데이터는 expo-notifications 규칙대로 최상위 `body` 객체(`kind`·`targetType`·`targetId`)에 둡니다(로컬 알림은 앱이 `data`에 직접 담습니다).
`expo-notifications` 플러그인은 `app.json`의 `plugins`에 넣지 않았습니다. 플러그인은 APNs 권한(`aps-environment`)을 붙여 무료 개발자 계정으로 서명할 수 없게 되고, 로컬 알림에는 필요 없습니다. Android FCM 작업에서 플러그인을 넣을 때 iOS 권한 영향을 확인하세요.
Android 13+는 권한을 요청하기 전에 알림 채널을 먼저 만들어야 권한 창이 뜹니다(`setNotificationChannelAsync`). iOS 작업에서는 필요 없어 넣지 않았으니 Android 작업에서 `src/device.ts`에 더하세요.

## 시뮬레이터용 빌드 받기 (Mobile CD)

Xcode 없이 시연하려면 GitHub Release의 서명 없는 시뮬레이터용 `.app`을 설치합니다. 유료 Apple 계정이 없어 실기기·TestFlight 배포는 하지 않습니다.

1. [Releases의 `mobile-ios-latest`](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/releases/tag/mobile-ios-latest)(prerelease, **iOS 시뮬레이터 빌드 (develop)**)에서 `STORYFORK-ios-simulator.zip`을 받습니다.
2. 압축을 풉니다. `STORYFORK.app`이 나옵니다.
3. 시뮬레이터를 켠 채 설치·실행합니다.

```bash
xcrun simctl install booted STORYFORK.app
xcrun simctl launch booted com.storyfork.app
```

- 웹 주소는 빌드 때 번들에 박힙니다. 저장소 변수 `MOBILE_API_BASE_URL`이 있으면 그 값, 없으면 앱 기본값 `http://localhost:5173`입니다(릴리스 본문에 적힙니다). 기본값이면 같은 Mac에서 로컬 Compose를 띄운 시뮬레이터에서만 웹이 뜹니다.
- 릴리스는 하나뿐입니다. 새 빌드가 `.zip`을 교체하고 본문을 고친 뒤 마지막에 태그를 그 커밋으로 옮기며, 본문의 커밋이 이 빌드의 소스입니다(첫 릴리스만 `--verify-tag` 때문에 태그를 먼저 만듭니다).
- 만드는 곳은 [`mobile-cd.yml`](../.github/workflows/mobile-cd.yml)입니다. develop의 CI가 성공하고 마지막 릴리스(태그의 커밋)와 비교해 `mobile/`이 달라졌으면 자동으로 돌고, Actions의 **Mobile CD → Run workflow → develop**으로 직접 돌리면 항상 빌드합니다. 빌드나 릴리스 갱신(`.zip` 교체·본문 수정)이 실패하면 태그가 옮겨지지 않아 다음 실행이 그 변경을 다시 싣습니다.
- macOS 러너에서 `npm ci` → `expo prebuild --platform ios --no-install` → `pod install` → `xcodebuild`(Release, `CODE_SIGNING_ALLOWED=NO`) → `ditto` 순서이고, 빌드가 실패하면 릴리스는 바뀌지 않습니다. `contents: write`는 릴리스를 올리는 job에만 있습니다.

## 테스트

`cd mobile && npx tsc --noEmit && npm test`입니다. `npm test`가 `node --test`에 `--experimental-strip-types`를 주어 TypeScript를 바로 읽으므로(Node 22.13+, 22.18+·24+는 기본값) 테스트 러너 의존성은 없고, 그래서 화면·네이티브 연결과 분리해 순수 `.ts` 모듈에 로직을 둡니다. CI는 `mobile/`이 바뀌면 같은 명령을 실행합니다.
화면 연결(`App.tsx`, `src/WebShell.tsx`, `src/TabBar.tsx`, `src/TabIcons.tsx`, `src/device.ts`)은 단위 테스트 없이 iOS 시뮬레이터에서 확인합니다.

| 파일 | 역할 |
|---|---|
| `src/bridge.ts` | 웹 → 앱 메시지 검증(zod)과 알림 기준선 반영 |
| `src/arrivals.ts` | 새로 도착해 로컬 알림을 띄울 알림 판정 |
| `src/webview.ts` | WebView 이동 판정(같은 origin·외부·차단)·알림을 눌렀을 때 갈 주소·탭 이동 스크립트 |
| `src/tabs.ts` | 하단 탭 5개와 웹 경로, WebView 주소에서 선택할 탭 판정 |
| `src/appearance.ts` | 웹 body 배경색 읽기(주입 스크립트·메시지 검증)와 상태바 띠·하단 탭의 웹 테마 색 |
| `src/notification.ts` | 알림 타입·`noticeTarget`(웹과 같은 규칙)·알림 데이터에서 이동 경로 만들기 |
| `src/config.ts` | 웹 주소(빈 값은 기본값)·웹 주소 만들기 |
| `src/WebShell.tsx`·`src/device.ts` | WebView 화면·상태바 띠·오류 안내·뒤로가기·브리지 수신 / 알림 권한·로컬 알림 |
| `src/TabBar.tsx`·`src/TabIcons.tsx` | 하단 탭 화면과 단색 선 아이콘(웹 `StrokeIcon`과 같은 24px·굵기 2) |
| `push-example.apns` | `simctl push` 예시 |

의존성: `react-native-webview`(웹 화면), `expo-notifications`(로컬 알림·권한), `zod`(브리지 메시지 검증), `react-native-safe-area-context`(노치·홈 인디케이터 여백. 내장 `SafeAreaView`는 deprecated이고 iOS 전용), `react-native-svg`(하단 탭 선 아이콘, 네이티브 모듈이라 추가 뒤에는 `npx expo run:ios`로 다시 빌드), 개발용 `@types/node`(`node:test` 타입, TypeScript 6은 `types` 기본값이 비어 있음).

## Expo 결정 요약 ([#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943))

- Expo 개발 빌드(`npx expo run:ios`·`run:android`)로 만듭니다. 앱을 열면 바로 STORYFORK 웹을 WebView로 보이고(로그인·회원가입·알림함·설정·독서·집필 모두 웹 화면 그대로) 앱은 알림과 하단 탭만 맡습니다. 그래서 `expo-secure-store`·네이티브 인증이 필요 없습니다.
- Android 푸시 토큰은 FCM 기기 토큰(`getDevicePushTokenAsync`)이고 Expo Push 서비스는 쓰지 않습니다(#89). Core 기기 토큰 API와 FCM 발송은 Android 작업입니다.
- 스토어 배포 없이 시연용 테스트 빌드만 만듭니다. iOS는 유료 계정 없이 시뮬레이터로 확인하므로 APNs 원격 푸시는 빼고, 웹이 읽은 알림을 앱이 로컬 알림으로 띄우는 것으로 대신합니다(앱을 켜 둔 동안만).
- 화면·알림 처리 로직은 한 코드로 쓰고, 플랫폼 차이는 푸시 토큰 발급과 권한 요청에만 둡니다.

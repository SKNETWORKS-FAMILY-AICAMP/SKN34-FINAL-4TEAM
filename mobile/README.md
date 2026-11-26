# STORYFORK 모바일 앱 (`mobile/`)

Android·iOS를 한 코드로 만드는 Expo(React Native, TypeScript) 앱입니다. Expo SDK 58·React Native 0.88·React 19.3입니다.
앱을 열면 STORYFORK 웹을 WebView로 표시합니다. [#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943) Android 범위는 개발 빌드·알림 권한·FCM 기기 토큰·탭 이동입니다.
웹과 같은 공개 `/api`만 호출하고 AI·DB는 직접 호출하지 않습니다([아키텍처](../docs/architecture.md)).

## 실행

Node 22.13+·24.3+·26+(React Native 0.88의 `engines`)와 npm이 필요합니다(검증: Node 22.22). iOS는 macOS의 Xcode·CocoaPods, Android는 Android Studio(SDK·에뮬레이터)를 씁니다.

```bash
adb reverse tcp:5173 tcp:5173  # 로컬 Android에서 웹을 쓸 때
cd mobile
npm ci
npx expo run:ios      # iOS 시뮬레이터에 개발 빌드를 설치·실행 (예: --device "iPhone 17 Pro")
npx expo run:android  # Android 에뮬레이터·기기에 개발 빌드를 설치·실행
npm test
npm run typecheck
```

루트 `.env`의 `MOBILE_WEB_URL`에 웹 주소를 지정합니다. 로컬 Android는 `http://127.0.0.1:5173`, 배포 주소는 HTTPS를 사용합니다.
원격 푸시를 검증할 때는 `com.storyfork.app`용 테스트 Firebase 파일을 `MOBILE_GOOGLE_SERVICES_FILE`로 지정하고 개발 빌드를 다시 만듭니다. Core에는 SNS FCM V1 플랫폼 ARN, 발송 자격과 `PUSH_SNS_ENABLED=true`를 설정합니다.

`ios/`·`android/`는 Expo가 `app.json`으로 생성하는 폴더라 커밋하지 않습니다(`.gitignore`). 네이티브 코드 수정이 필요하면 `npx expo prebuild`로 꺼냅니다.
앱 식별자는 iOS `bundleIdentifier`·Android `package` 모두 `com.storyfork.app`, 링크 scheme은 `storyfork`입니다.
`google-services.json`·`GoogleService-Info.plist`·`.env*`는 커밋하지 않습니다(설정은 루트 `.env` 하나).

## Expo 결정 요약 ([#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943))

- Expo 개발 빌드를 사용합니다. 로그인·회원가입·알림함·설정·독서·집필을 한 WebView에서 엽니다. 인증은 기존 HttpOnly 쿠키와 웹의 접근 토큰 수명에 따릅니다. SecureStore에는 Android 설치 UUID만 보관합니다.
- Android 푸시 토큰은 FCM 기기 토큰(`getDevicePushTokenAsync`)이고 Expo Push 서비스는 쓰지 않습니다(#89).
- 전면 로컬 알림은 웹 SSE로 갱신한 알림 목록을 사용합니다. Android 백그라운드 푸시는 AWS SNS → FCM V1으로 전달합니다. 알림을 누르면 본인의 저장된 알림을 다시 읽고 기존 웹 이동 규칙을 적용합니다.
- 스토어 배포 없이 시연용 테스트 빌드만 만듭니다. iOS는 유료 계정 없이 시뮬레이터로 확인하므로 APNs 원격 푸시는 빼고, 앱 사용 중 알림 SSE → 로컬 알림으로 대신합니다.
- 화면·API 호출·푸시 처리 로직은 한 코드로 쓰고, 플랫폼 차이는 푸시 토큰 발급과 권한 요청에만 둡니다.

포크의 CI를 `record_android=true`로 수동 실행하면 에뮬레이터에서 실제 웹 로그인·Core 사건·로컬 알림·탭 이동·알림 읽음/삭제를 검사하고 개발 APK와 녹화 영상을 artifact로 보관합니다. APK에 자바스크립트 번들을 포함하고, 테스트 웹 주소에는 에뮬레이터의 ADB 포트 연결로 접속합니다. 이 검증에는 Firebase·SNS 설정을 사용하지 않습니다.

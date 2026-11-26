# STORYFORK 모바일 앱 (`mobile/`)

Android·iOS를 한 코드로 만드는 Expo(React Native, TypeScript) 앱입니다. Expo SDK 58·React Native 0.88·React 19.3입니다.
지금은 첫 화면만 있는 골격이며 로그인·알림함·알림 설정·푸시는 [#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943)의 다음 PR에서 만듭니다.
웹과 같은 공개 `/api`만 호출하고 AI·DB는 직접 호출하지 않습니다([아키텍처](../docs/architecture.md)).

## 실행

Node 22.13+·24.3+·26+(React Native 0.88의 `engines`)와 npm이 필요합니다(검증: Node 22.22). iOS는 macOS의 Xcode·CocoaPods, Android는 Android Studio(SDK·에뮬레이터)를 씁니다.

```bash
cd mobile
npm install
npx expo run:ios      # iOS 시뮬레이터에 개발 빌드를 설치·실행 (예: --device "iPhone 17 Pro")
npx expo run:android  # Android 에뮬레이터·기기에 개발 빌드를 설치·실행
npx tsc --noEmit      # 타입 검사
```

`ios/`·`android/`는 Expo가 `app.json`으로 생성하는 폴더라 커밋하지 않습니다(`.gitignore`). 네이티브 코드 수정이 필요하면 `npx expo prebuild`로 꺼냅니다.
앱 식별자는 iOS `bundleIdentifier`·Android `package` 모두 `com.storyfork.app`, 링크 scheme은 `storyfork`입니다.
`google-services.json`·`GoogleService-Info.plist`·`.env*`는 커밋하지 않습니다(설정은 루트 `.env` 하나).

## Expo 결정 요약 ([#943](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/943))

- Expo 개발 빌드(`npx expo run:ios`·`run:android`)로 만듭니다. 알림·토큰은 `expo-notifications`, 로그인 토큰 보관은 `expo-secure-store`를 쓰며 둘 다 다음 PR에서 추가합니다.
- Android 푸시 토큰은 FCM 기기 토큰(`getDevicePushTokenAsync`)이고 Expo Push 서비스는 쓰지 않습니다(#89).
- 네이티브 화면은 로그인·알림함·알림 설정만 만들고 독서·집필 등 나머지는 웹 주소로 엽니다.
- 스토어 배포 없이 시연용 테스트 빌드만 만듭니다. iOS는 유료 계정 없이 시뮬레이터로 확인하므로 APNs 원격 푸시는 빼고, 앱 사용 중 알림 SSE → 로컬 알림으로 대신합니다.
- 화면·API 호출·푸시 처리 로직은 한 코드로 쓰고, 플랫폼 차이는 푸시 토큰 발급과 권한 요청에만 둡니다.

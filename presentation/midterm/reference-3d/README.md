# STORYFORK 중간발표 · 3D 시각화 프로토타입

실제 서비스 화면이 아닌 독립적인 발표용 영상 소스입니다. 서비스 API·DB를 호출하지 않습니다.

| 영상 | 파일 | 규격 |
|---|---|---|
| 홍길동전 세계관 지식 그래프 | `renders/graph.mp4` | 14초 · 1920×1080 · 30fps |
| Fork 시간선 | `renders/fork.mp4` | 11초 · 1920×1080 · 30fps |

두 MP4는 H.264 / yuv420p / faststart, 무음입니다. 대표 이미지는 `renders/graph-poster.png`, `renders/fork-poster.png`입니다.

## 영상 디자인 v2

기존 16:9 구도에 실제 Three.js 블룸, 발광 코어, 광섬유 셰이더, 움직이는 입자를 추가했습니다. 각 관계의 광섬유는 같은 두 노드 사이에서만 움직입니다. 주변 리본과 먼지는 장식입니다. 시간선의 세 경로는 각각 76개 섬유와 3,200개 이동 입자로 구성했습니다. 광선과 텍스트는 따로 렌더링해 글자가 번지지 않도록 했습니다. 참고 이미지는 영상에 삽입하지 않았고 Remotion은 사용하지 않았습니다.

## 실행

Node.js 20.19+ 또는 22.12+ (이 환경에서는 24.21), npm이 필요합니다.

```powershell
npm ci
npm run dev
```

[그래프](http://127.0.0.1:5186/?scene=graph) / [Fork](http://127.0.0.1:5186/?scene=fork)

화면 하단에서 장면 전환·일시 정지·처음부터 재생이 가능합니다. 영상은 고정 16:9 구도를 화면 크기에 맞춰 축소합니다. 브라우저 전체화면에서 보거나 MP4를 슬라이드에 삽입하세요. 파일을 직접 더블클릭하는 대신 로컬 서버를 사용합니다.

## 재생성 및 검증

Chrome, FFmpeg, FFprobe가 필요합니다. 인코더가 PATH에 있어야 합니다.

```powershell
npm run check
npm run build
# 별도 터미널에서 npm run dev가 실행 중이어야 합니다.
node scripts/capture.mjs --qa
npm run capture
node scripts/verify-video.mjs
```

캡처는 Playwright가 설치된 Chrome을 별도 프로필로 실행합니다. 사용자 브라우저의 로그인·쿠키는 사용하지 않습니다. Edge는 `$env:BROWSER_CHANNEL='msedge'`로 선택할 수 있습니다. 임의 시간의 장면을 `window.renderAt(seconds)`로 렌더링하고 프레임별 PNG를 FFmpeg로 전달합니다. 실시간 화면 녹화의 프레임 누락을 피하는 방식이며, 인코딩에 걸린 시간은 영상 재생 길이보다 깁니다.

## 데이터와 원작 사실의 범위

사용자의 요청에 따라 기존 홍길동전 자료를 사용했습니다. `public/evidence/episode-1.txt`, `episode-2.txt`는 기존 `honggildong-worktree/docs/episode-studio-e2e/reader-original-1.txt`, `reader-original-2.txt`의 복사본입니다. `world-input.txt`는 참고용 작가 설정집 복사본이며 원문 확정 관계의 근거로 사용하지 않았습니다.

`src/data.js`에 14개 노드와 20개 연결의 원문 파일·검색 가능한 짧은 근거 구절을 기록했습니다. 조직 노드는 원문에 등장하는 조정입니다. 홍길동의 활빈당 가입·율도국 왕위·추정 관계는 표시하지 않습니다. 세계관 색상의 조선국은 배경을 나타냅니다. 노드 좌표·크기·카메라·관계 강조는 발표용 수동 연출로, 서비스 분석 결과나 측정된 의미 거리와 다릅니다. 원문의 구간 나누기를 회차로 사용했으며 공인 판본의 장 번호라는 주장은 하지 않습니다.

Fork A/B는 각각 원작 EP.02/03에서 분기하는 **허용 정책 예시**입니다. 실제 작품의 공개 상태·권한·허용 회차를 조회하거나 변경하지 않았습니다. 분기 후 사건 내용은 창작하지 않았으며 독립적인 시간선만 보여 줍니다. 재Fork는 구현·표현하지 않습니다.

## 구현과 발표용 연출의 구분

- 실제 구현: `react-force-graph-3d` 장면, Three.js 카메라, 원문 근거가 있는 로컬 데이터, 원작 곡선에서만 시작하는 두 Three.js 곡선, 재생 제어, 고정 시점 캡처, MP4 인코딩.
- 발표용 연출: 자동 카메라 접근, 노드 강조, 발광 곡선, 예시 Fork 허용 회차.
- 구현하지 않음: 서비스에 3D 그래프 추가, DB 관계 추출, 실제 Fork 생성·권한 승인, API 통합.

## 참고와 라이선스

- [vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph): 3D React 컴포넌트 및 cameraPosition API.
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer): 3D 렌더링.
- [Pretendard](https://github.com/orioncactus/pretendard): 자체 호스팅 폰트, SIL Open Font License (`public/fonts/LICENSE`).
- 마블의 영상·로고·음악·모델·텍스처는 사용하지 않았습니다. 곡선·조명·배치·움직임은 코드로 제작했습니다.

상세 검사 결과와 실패/수정 이력은 `VALIDATION.md` 및 `renders/*-report.json`을 참고하세요.

# STORYFORK 중간발표 시연 패키지

2026-11-06 기준. 실제 React 화면에 홍길동전 예시 데이터를 미리 넣은 발표용 목업이다.
API·DB·외부 AI 없이 실행한다. 화면의 AI 검토 후보와 대화는 미리 준비한 예시이며 실제 AI 실행 결과로 발표하지 않는다.

## 폴더 구성

| 폴더 | 내용 |
| --- | --- |
| `react-app/` | 현재 React 프론트엔드 전체 소스와 잠금 파일의 발표용 복사본 |
| `site/` | presentation 모드로 빌드한 최신 실행 파일 |
| `sample-data/` | 세계관·원작 1·2화·분기 요청·기존 생성 결과 |
| `screenshots/` | 세계관 지도, 인물 선택 블러, 시간선, WIKI, 관계 편집, 캐릭터 챗 화면 |
| `reference-videos/` | 세계관 지도·Fork 시간선 참고 영상과 포스터 |
| `reference-3d/` | 참고 영상 제작용 React·Three.js 소스 |
| `legacy-html/` | 이전 HTML 목업. 현재 발표 본편은 React를 사용 |

`react-app`은 배포 편의를 위한 스냅샷이다. 이후 개발 기준은 저장소의 `frontend/`이며 두 소스는 자동 동기화되지 않는다.
`sample-data/시연순서.txt`는 과거 API 기반 시연 계획이다. 이번 발표에는 아래 흐름을 사용한다.

## 실행

Node.js 24와 pnpm 11.22.x가 필요하다. 터미널에서 이 폴더의 `react-app`으로 이동한다.

```sh
pnpm install --frozen-lockfile
pnpm exec vite preview --host 127.0.0.1 --port 8798 --strictPort --outDir ../site
```

브라우저에서 http://127.0.0.1:8798/worlds/hong-world 를 연다.
HTML 파일을 직접 더블클릭하지 않는다. React 경로 이동을 지원하는 Vite preview로 실행한다.

소스를 수정하며 실행하려면:

```sh
pnpm exec vite --mode presentation --host 127.0.0.1 --port 8798 --strictPort
```

발표 실행 파일을 다시 만들려면:

```sh
pnpm exec vite build --mode presentation --outDir ../site
```

반드시 `--mode presentation`을 사용한다. 일반 실행 모드는 실제 API 연결을 사용한다.
목업 세계관 변경은 메모리에 저장되며 새로고침하면 준비된 데이터로 돌아간다.
참고 영상 소스는 별도 프로젝트다. `reference-3d`에서 `npm ci`, `npm run dev`로 실행한다.

## 발표 흐름

1. **등록 방식 소개**: 새 세계관 등록 입력란에 예시를 잠깐 입력한다. 생성·저장은 하지 않는다.
2. **등록된 세계관 선택**: `홍길동전 · 홍문의 집`을 연다. 작가는 이미 등록한 설정을 관리한다는 점을 설명한다.
3. **인물·관계 관리**: 길동·홍문·춘섬의 소개와 PPT 인물 이미지, 부모 관계·신뢰·경계를 보여준다.
4. **전체 세계관 지도**: `지도 넓게 보기` → 홍문 선택. 관련 인물과 설정은 강조되고 나머지는 흐려진다. 선택 해제로 전체 연결을 보여준다.
5. **설정집 WIKI**: 문서 분류·목차·인물 정보표 → 인물 관계의 홍문 링크 → 이전 문서 → 관련 사건·규칙 문서. 세계관 목록을 접으면 본문을 넓게 보여줄 수 있다.
6. **시간선**: 1화 호칭 요청 → 2화 떠날 뜻을 밝힌 사건을 선택한다. 3화 출발은 집필 예정이므로 확정 과거 사건과 구분한다.
7. **AI 후보 검토**: `춘섬이 출발 계획을 알고 있다`와 `길동이 이미 떠났다`를 원문과 대조한다. 아직 떠나지 않았으므로 두 후보를 구분해야 한다.
8. **집필·캐릭터 챗**: 내 서재의 `홍길동전 · 갈림길`에서 준비된 원고·플롯·스토리보드·대화 예시를 보여준다.
9. **Fork**: 2화 이후 다른 선택인 `등잔 아래 나눈 의논`을 보여준다. 원작과 분기 작품을 구분한다.

시간선은 간결한 사건 연결도다. `reference-videos`의 화려한 Fork 영상과 현재 React 시간선은 서로 다른 화면이다.

## 데이터와 이미지

- 시연 데이터: `react-app/src/data/mock/presentation.ts`, `hongPresentation.json`
- PPT 인물 이미지: `react-app/src/app/presentation-assets/`
- 이름과 이미지 연결: `react-app/src/app/presentationPortraits.ts`
- 세계관 지도·시간선·WIKI: `react-app/src/presentation/features/studio/view/`
- 원고 출처와 이전 생성 결과 설명: `sample-data/시연순서.txt`

## 확인 범위

관련 목업 데이터·지도·시간선·WIKI 테스트, TypeScript 검사, 변경 파일 린트와 presentation 빌드를 로컬 확인했다.
브라우저에서 지도 펼치기·인물 선택, 사건 선택, WIKI 문서 이동·이전 문서·검색 결과 없음 동작을 확인했다.
실서비스 API·DB 연결 검증이나 실제 AI 호출을 완료했다는 의미는 아니다. CI 결과는 브랜치의 GitHub Actions에서 별도로 확인한다.

비밀키, 개인 환경 설정, node_modules, 임시 로그와 중복 빌드 캐시는 포함하지 않는다.

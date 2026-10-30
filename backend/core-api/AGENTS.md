# Core API 구현 지침

`backend/core-api/**`에 적용한다. [루트 공통 지침](../../AGENTS.md)을 함께 따른다.
아래 STORYFORK 업무 경계는 후속 구현 기준이며 현재 기능이 구현되었다는 뜻이 아니다.

## 기능 중심 배치

- Kotlin 기본 패키지는 `ai.storyfork.core`다. 소스 루트는 `src/main/kotlin/ai/storyfork/core/`이며
  루트 패키지를 생략하지 않고 실제 디렉터리와 `package` 선언을 정확히 일치시킨다.
- 업무 코드는 기능 디렉터리 안에서 `controller → service → repository` 또는 외부 호출 시
  `controller → service → (선택적 facade) → client` 흐름을 사용하고,
  프레임워크와 무관한 업무 모델은 `domain`에 둔다.
- `_health`와 `_health_ai_service`만 상태 확인 기능으로 제공한다.
  `_common`에는 기존 HTTP 설정·오류 격리와 전역 CORS가 남아 있다. 업무 기능 폴더는 미리 만들지 않는다.
- 공개 HTTP 계약은 해당 기능의 `controller/dto`, 외부 시스템 계약은 `client/dto`, 검증된 내부
  실행 결과는 `service/dto`, 프레임워크와 무관한 업무 모델은 `domain`에 둔다.
- 외부 DTO를 내부 모델로 변환하는 Mapper는 해당 외부 시스템의 `client/mapper`에 둔다.
- 외부 시스템에서만 사용하는 예외는 해당 시스템의 `client/exception`에 둔다.
- DTO, 예외, 설정을 프로젝트 전체의 중앙 폴더에 모으지 않고 그 계약을 소유하는 기능 가까이에 둔다.

## 역할별 이름

- 공개 HTTP 진입점은 `Controller`, 업무 흐름은 `Service`, 외부 HTTP 통신은 `Client`로 끝낸다.
- 하위 Client 호출·응답 검증·도메인 변환을 하나의 진입점으로 감추는 객체는 `Facade`로 끝낸다.
- 외부 DTO 변환은 `Mapper`, Spring 구성은 `Config`, 환경설정 값은 `Properties`로 끝낸다.
- 전송 객체는 경계에 맞춰 `Request`, `Response`, `Payload`, `Result`를 사용한다. 필드가 같다는
  이유만으로 서로 다른 경계의 타입을 합치지 않는다.
- 이름은 수행 역할을 드러내야 하며 `Support`, `Util`, `Common`처럼 의미가 모호한 접미사를
  새로 만들지 않는다.

## Helper 규칙

- 다른 코드의 반복 작업을 보조하는 파일과 `object`·클래스 이름은 `Helper`로 끝낸다.
- 둘 이상의 기능이 실제로 함께 사용하는 Helper는 `_common/helper`에 둔다.
- 특정 기능이나 외부 시스템만 사용하는 Helper는 해당 기능의 `helper` 디렉터리에 둔다.
- Helper 함수 이름은 `executeHttpCall`, `buildRestClient`, `decode`처럼 동작을 나타내며
  함수 이름에 `Helper`를 반복하지 않는다.
- `Controller`, `Service`, `Facade`, `Client`, `Mapper`처럼 더 정확한 역할명이 있으면 Helper로
  분류하지 않는다.
- 실제 사용처가 하나뿐이고 호출부 안에 두는 편이 더 명확한 작은 함수는 불필요하게 별도
  Helper 파일로 추출하지 않는다.

## 의존 방향과 변경 원칙

- 기본 의존 방향은 `Controller → Service → Repository` 또는
  `Controller → Service → (선택적 Facade) → Client`다. Facade는 필수 계층이 아니다.
- Controller는 Facade나 Client를 직접 호출하지 않고 사용자 유스케이스를 담당하는 Service만 호출한다.
- Service는 필요한 Repository를 직접 사용하며, 외부 하위 시스템의 호출·검증·변환이
  복잡할 때만 Facade를 사용한다. 단순 Client 호출을 한 줄 전달하는 Facade는 만들지 않는다.
- Facade는 상위 Service를 다시 호출하지 않는다. `Service ↔ Facade` 순환 의존성은 금지한다.
- Facade가 필요 없는 단순 외부 호출은 Service가 Client를 직접 사용할 수 있다.
- 외부 시스템의 원본 JSON과 예외를 공개 API에 그대로 노출하지 않는다. Client 경계에서 DTO와
  안정적인 내부 예외로 변환한다.
- 새로운 공통 추상화는 production 사용처가 둘 이상이거나 외부 시스템 장애·보안 경계를
  격리해야 할 때만 추가한다.
- 구조나 이름을 변경하면 [Core README](README.md)와 [아키텍처 문서](../../docs/architecture.md)도 함께 갱신한다.

## 정본·권한·승인 경계

- 공용 세계관 정의와 작품별 상태, 원작·Fork·미공개 초안·시뮬레이션 상태를 분리한다.
  버린 시뮬레이션의 사건·기억을 정본이나 다른 실행에 반영하지 않는다.
- Fork는 허용된 회차의 정확한 revision과 당시 허용 state를 고정한다.
  회차 번호만으로 현재 원작을 다시 읽거나 원작 후속 변경을 자동 유입하지 않는다.
- 작가 비공개 정보, 독자 공개 범위, Fork 분기 시점, 캐릭터 지식을 구분한다.
  사용자가 보낸 ID나 프롬프트만 신뢰하지 말고 Core에서 권한·허용 문맥을 확인한다.
- 사용자가 선택·승인한 제안만 권한과 기준 버전을 검증한 뒤 반영한다. 수정안에는 기준 버전·변경 전후·근거·
  처리 상태를 연결하고, 기준 버전이 바뀌면 무조건 덮어쓰지 않는다. 작품 내 PR은 GitHub 연동을 전제하지 않는다.
- AI 응답 성공을 저장·승인·발행 성공으로 처리하지 않는다. 접수·검토·승인·반영의 실제 상태를 반환한다.
- 작품 등록이나 Fork 설정만으로 외부 IP 권한이 생기지 않는다. AI 처리·Fork·열람·공개·유료 공개 권한을 구분한다.
  신고·중단·소명·재개 및 허가 철회의 기존 Fork 영향은 상세 정책 합의 후 구현한다.
- 크레딧 잔액·사용 확정·복구는 Core가 판단한다. AI 사용량 보고를 금전성 원장 자체로 취급하지 않는다.
  열람료와 AI 이용료, 유료 충전분과 보상 크레딧을 구분하고 실행 전에 비용을 안내한다.
  미정인 금액·한도·배분율·재시도·오류 복구 기준은 임의로 정하지 않으며 실패를 성공 차감으로 숨기지 않는다.
- 저장 한도·추가 비용은 사전 안내하고 한도 초과로 기존 작품을 자동 삭제하지 않는다.
- AI 자율 연재의 허용·발행·검토·중단·비용 조건은 아직 미정이다. 합의 전에 자동 발행이나 worker를 추가하지 않는다.

## 검증

- 테스트 패키지는 production 패키지 구조를 따라 배치한다.
- 로컬: JDK 21 환경의 `backend/core-api`에서 `./gradlew test --tests '<대상 테스트 클래스 또는 패턴>' --no-daemon`으로
  관련 테스트를 실행한다. 파일 이동·빌드 설정·리소스 변경이나 오래된 산출물이 의심될 때만 `clean`을 추가한다.
- CI: `./gradlew clean test --no-daemon` 전체 실행. 문서만 변경한 경우는 루트의 문서 검증 기준을 따른다.
- 파일 이동 후에는 이전 package·import·문서 경로가 남지 않았는지 `rg`로 확인하고
  `git diff --check`를 통과시킨다.

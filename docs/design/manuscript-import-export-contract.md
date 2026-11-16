# 원고 가져오기·내보내기, 첨부 파일명 수정, 원고 이미지 관리 계약 (기능 16-C·17·18)

> 정본 근거: [UC-03](../usecase-spec/UC-03.md), [UC-10 A8](../usecase-spec/UC-10.md), [F-WLD-05·09, F-WRT-13](../requirements.md), [미등록-013·014](../feature-roadmap.md#미등록-013).
> 서비스 책임: Content(DEC-41). Core·AI·Operations 변경 없음.

## 결정 (2026-11-09 사용자 확정)

| 항목 | 결정 |
|---|---|
| 처리 위치 | TXT·EPUB 파싱·생성은 Content 서버에서 JDK `java.util.zip`·`javax.xml`로 한다. 새 의존성 없음 |
| 등록 흐름 | 상태 저장 없는 2단계. 미리보기는 파싱 결과만 반환하고 저장하지 않는다. 확정은 같은 파일과 조정한 경계·선택을 다시 보내 서버가 재파싱한다 |
| 실패 항목 | 확정 응답에 회차별 결과로 담아 화면에 표시한다. 별도 테이블·작업 ID 없음(가져오기용 Flyway 없음. 16-C 대체 텍스트만 contentimage V2) |
| PR #227과의 관계 | develop 기준. 새 Import/Export 전용 Service·Controller에 구현하고 `EpisodeService`·`EpisodeVersionService`·`WritingStudio`·`useWritingViewModel`은 공개 메서드 호출만 하거나 한 줄만 바꾼다. 나중에 병합되는 쪽이 충돌을 해결한다 |
| 첨부 메타데이터 | 설정 첨부의 파일명 변경만 지원한다(확장자 유지) |
| 화면 | 실제 모드 `/import`는 실제 API, `--mode mockup`은 기존 데모 유지. 집필실 내보내기는 서버 API |

## 공통 규칙

- 경로는 기존 `/api/v1/works/**`(인증 필요, Content 라우팅) 아래다. Security·라우팅 규칙 변경 없음. 소유자가 아니면 기존 관례대로 404다.
- 오류 본문은 기존 `ContentFailure` → `{"detail": "..."}`(첨부 API는 기존 `AttachmentFailure` 형식) 관례를 따른다. 프런트는 `detail`을 그대로 보여 준다.
- 업로드 한도: TXT 10MB, EPUB 50MB, 한 번에 300회차 이하. Content `spring.servlet.multipart.max-file-size=50MB`, `max-request-size=51MB`이고 첨부 업로드는 기존 `AttachmentUploadHelper` 10 MiB 검사를 그대로 유지한다. nginx(`frontend/nginx.conf`, `infrastructure/nginx.dev.conf`)의 `/api/v1/works/` 위치에 `client_max_body_size 51m;`를 둔다.
- 회차 원고 검증은 기존 규칙을 재사용한다: 제목 1~120자, 본문 40,000자 이하, 이미지는 `[[image:<UUID>]]` 참조만.

## 작품 관리 회차 파일 일괄 업로드 (#333)

- `/content?work=<id>`의 회차 탭에서 TXT·EPUB을 최대 1,000개 선택한다. 자연 정렬을 기본으로 하고 작가가 순서와 시작 회차를 바꾼다. 파일명에서 확장자를 뺀 이름을 제목으로 쓴다. 기존 회차에 새 버전이 쌓이는 행을 미리 표시한다.
- 파일 하나를 회차 하나로 읽는다. TXT는 UTF-8·CP949로 읽고 본문의 회차 제목 줄을 보존한다. EPUB은 spine 순서대로 XHTML 본문과 머리글을 합치고 삽화는 제외한다. 본문 문서가 손상됐거나 누락된 EPUB은 파일 단위로 실패한다. 변환한 본문은 40,000자까지 저장한다.
- `GET /api/v1/works/{workId}/manuscript-imports/bulk`는 소유자에게 `lastNumber`와 `workRevision`을 반환한다. `POST`는 같은 경로에 `files` 반복 파트와 `request` JSON(`rightsConfirmed`, `expectedWorkRevision`, 파일과 같은 순서의 `items[{number,title}]`)을 받는다. 기존 인증·CSRF·소유권 규칙을 적용한다.
- 브라우저는 요청당 파일 20개와 파일 합계 50 MiB를 기준으로 묶어 순서대로 전송한다. 전체 선택에는 바이트 합계 상한을 따로 두지 않는다. 파일당 TXT 10 MiB·EPUB 50 MiB, multipart 전체 Spring/Nginx 51 MiB 기준을 적용한다. 요청 용량 초과는 413, 요청 검증 오류는 422로 반환한다.
- 파일별 트랜잭션에서 새 회차는 생성과 버전 저장을 함께 처리한다. 기존 회차는 필요한 경우 작업 중인 초안을 먼저 보존하고 업로드 원고를 새 버전으로 쌓는다. 상속 회차와 앞 번호가 비어 있는 신규 회차는 실패한다. 파일별 결과는 `created`, `versioned`, `failed`이고 성공 행의 `versionId`는 이번에 저장한 원고 버전 ID다.
- 묶음 응답은 최신 확인 `workRevision`을 반환한다. 앞 묶음이 반환한 revision을 다음 묶음에 쓰며, 동시 수정이나 저장 결과 미확인으로 중단되면 받은 결과와 `stopReason`을 표시한다. 실패가 확인된 파일은 교체해 원래 번호로 재시도할 수 있다. 저장 여부가 불명확한 요청은 저장본을 확인한 뒤 다시 시작한다.
- 원본 파일은 DB·객체 저장소에 보관하지 않는다. 파일 입력 스트림은 처리 후 닫고 multipart 임시 파일은 요청 종료 시 컨테이너가 정리한다. DEC-50 전처리는 작가가 별도로 시작하며 업로드 응답에서 확인한 저장 버전 ID를 기준으로 삼을 수 있다.

## 1. 설정 첨부 파일명 수정 (기능 17 · 파일 메타데이터 수정)

`PATCH /api/v1/works/{workId}/settings/{settingId}/attachments/{attachmentId}` · JSON `{"filename": "새 이름.pdf"}` · CSRF 필요

- 200: 기존 첨부 응답(`AttachmentResponse`)과 같은 형식.
- 422 `ATTACHMENT_INVALID`: 업로드와 같은 파일명 규칙(`[\p{L}\p{N} _().-]{1,120}`, 앞뒤 공백·`.` 시작·`..` 금지)을 어기거나 확장자가 바뀐 경우(대소문자 무시 비교). 확장자로 형식이 정해지므로 바꾸지 못하게 한다.
- 404: 작품·설정·첨부가 없거나 소유자가 아님. 저장소 객체는 건드리지 않는다(DB 파일명만 바꿈).

## 2. 원고 미리보기 (기능 18 · TXT/EPUB 업로드, 회차 자동 구분, 등록 미리보기)

`POST /api/v1/works/{workId}/manuscript-imports/preview` · multipart `file` · CSRF 필요 · 저장 없음

```json
{
  "format": "txt",            // "txt" | "epub" (확장자와 내용으로 판별)
  "unit": "line",             // txt="line", epub="chapter"(spine 항목)
  "unitCount": 1830,
  "existingEpisodeCount": 3,  // 현재 작품 회차 수(상속 포함)
  "episodes": [
    {"title": "1화 시작", "from": 0, "to": 120, "charCount": 5120, "excerpt": "앞 300자…", "imageCount": 0, "warnings": []}
  ]
}
```

- `from`(포함)·`to`(제외)는 `unit` 기준 위치다. 화면은 이 값을 그대로 확정 요청에 쓴다.
- `warnings` 예: `"본문이 40,000자를 넘어 등록할 수 없어요."`, `"지원하지 않는 이미지 2개는 빠져요."`. 경고가 있어도 미리보기는 200이다.
- TXT 회차 구분: 대소문자를 무시하고 `^\s*(제\s*\d+\s*화|\d+\s*화|chapter\s+\d+)` 패턴이면서 60자 이하인 줄을 회차 제목 줄로 본다. 제목은 그 줄(앞뒤 공백 제거, 120자 절단), 본문은 다음 줄부터 다음 제목 줄 전까지이며 앞뒤 빈 줄을 뺀다. 첫 제목 줄 앞의 내용은 첫 회차 본문 앞에 붙인다(`from=0`). 제목 줄이 없으면 전체가 회차 1개이고 제목은 파일명(확장자 제외)이다.
- TXT 인코딩: BOM을 제거하고 엄격한 UTF-8 → 엄격한 CP949(`MS949`, EUC-KR 포함) 순으로 시도한다. 둘 다 실패하면 422.
- EPUB: `META-INF/container.xml` → OPF → spine 순서의 XHTML이 단위다. 제목은 nav/NCX 목차 레이블 → 본문 첫 `h1~h3` → `<title>` → `"{순번}화"` 순이다. 블록 요소(`p`, `div`, `h1~h6`, `li`, `br`)는 줄바꿈으로, `img`는 그 위치에 이미지 표식으로 바꾼다. 미리보기 `excerpt`에는 이미지 표식 대신 `[이미지]`를 쓴다.
- 오류: 413 한도 초과(TXT 10MB·EPUB 50MB), 422 형식 미지원(`.txt`·`.epub` 외)·DRM·인코딩 판별 실패·읽기 실패·회차 300개 초과. 각 사유는 `detail`로 구분해 안내한다.

### 보안 (미등록-014)

- DRM: `META-INF/rights.xml`이 있거나 `META-INF/encryption.xml`에 글꼴 난독화(`http://www.idpf.org/2008/embedding`, `http://ns.adobe.com/pdf/enc#RC`) 외의 `EncryptionMethod`가 있으면 DRM으로 보고 422.
- 압축 폭탄: 헤더 크기를 믿지 않고 실제로 읽은 바이트를 센다. 항목 2,000개, 항목당 50MB, 전체 해제 200MB를 넘으면 422. 메모리에 남기는 항목은 텍스트(XHTML·OPF·NCX 등) 4MiB, 이미지 10MiB까지다: 텍스트가 넘으면 EPUB 전체 422, 이미지가 넘으면 빠진 이미지로 세고, 그 밖의 항목(글꼴·CSS 등)은 고정 버퍼로 크기만 센다.
- 경로 조작: zip 항목을 디스크에 쓰지 않는다. OPF·XHTML의 href는 OPF 기준으로 정규화하고, zip 루트를 벗어나거나(`..`) 절대 경로·스킴(`http:`, `https:`, `data:`, `file:` 등)이면 그 자원을 쓰지 않는다(이미지면 빠진 이미지로 센다).
- 외부 리소스 로딩: XML 파서는 `FEATURE_SECURE_PROCESSING`을 켜고 외부 일반·매개변수 엔티티, 외부 DTD 로딩, XInclude, 엔티티 확장을 끈다. 네트워크 요청은 하지 않는다. XHTML의 `<!DOCTYPE html>`은 허용하되 DTD를 읽지 않으며, 흔한 HTML 이름 엔티티(`&nbsp;` 등)는 파싱 전에 숫자 참조로 바꾼다. 그래도 파싱되지 않는 장은 그 회차의 경고/실패로 처리한다.
- 이미지: 기존 원고 이미지 규칙(PNG·JPEG, 장당 10MB, `content_image` CHECK)을 그대로 쓴다. UC-03의 WebP는 기존 CHECK 완화 마이그레이션이 필요해 이번 범위 밖이며 빠진 이미지로 처리한다. 그 밖의 이미지는 빼고 `imageCount`·결과의 `missingImages`에 반영한다.

## 3. 원고 등록 확정 (기능 18 · 원고 등록 확정, 실패 항목 조회)

`POST /api/v1/works/{workId}/manuscript-imports` · multipart `file` + `request`(JSON part, `application/json`) · CSRF 필요

```json
{
  "rightsConfirmed": true,
  "items": [ {"number": 1, "title": "1화 시작", "from": 0, "to": 120} ]
}
```

- `rightsConfirmed`가 `true`가 아니면 422(UC-03 2단계 권리 확인). 화면은 본인 저작물·계약상 제한·이미지 이용 권한 확인 체크를 받은 뒤에만 보낸다.
- `number`는 작품의 목표 회차 번호다. 화면은 조정한 회차 목록에서의 순서(1부터)를 쓰고, 제외한 회차는 보내지 않는다(번호는 유지).
- 요청 검증(실패 시 전체 422, 아무것도 저장 안 함): 파일 재파싱 성공, `items` 1~300개, `number` 오름차순·중복 없음·1 이상, `from<to`, 범위가 `0..unitCount` 안이며 서로 겹치지 않고 오름차순.
- 새 작품은 빈 1회차를 갖고 시작하므로 `existingEpisodeCount=1`이며 번호 1은 `versioned`가 된다.
- 회차별 처리(각 회차 독립 트랜잭션, 번호 오름차순):
  - `number ≤ 현재 회차 수`: 그 회차에 새 저장 버전을 쌓는다(UC-03 E4, 기존 `EpisodeVersionService.save` 재사용 — 초안을 바꾸고 저장 버전을 만든다). 발행본은 바꾸지 않는다. 상속 회차면 실패("원작 기준 회차는 수정할 수 없어요."). 쌓기 전에 현재 초안(`hasDraft`)의 제목·본문이 최신 저장 버전과 다르면(저장 버전이 없으면 본문이 비어 있지 않으면) 그 초안을 그대로 먼저 저장 버전으로 보존해 미저장 입력을 덮어쓰지 않는다. 빈 초안(새 작품의 빈 1회차 등)은 보존하지 않고, 보존과 쌓기는 한 트랜잭션이다.
  - `number = 현재 회차 수 + 1`: 기존 `EpisodeService.create`로 회차를 만든 뒤 같은 방식으로 저장 버전을 만든다.
  - `number > 현재 회차 수 + 1`: 실패("앞 회차가 없어 등록할 수 없어요."). 앞 회차 실패로 생긴 공백도 같다.
  - EPUB 이미지는 회차가 생긴 뒤 기존 원고 이미지 저장(`AttachmentService.createEpisodeImage`) 경로로 올리고 본문의 이미지 위치에 `[[image:<id>]]`를 넣는다. 이미지가 빠지면 본문은 저장하고 상태를 `partial`로 둔다(UC-03 E6). 본문 저장이 실패하면 그 회차에 올린 참조 없는 이미지를 지우고, 이번 요청에서 새로 만든 빈 회차도 지운다(UC-03 최소 보장 "실패 항목은 저장되지 않는다"; 회차 삭제 정책 DEC-42가 바뀌면 그 정책을 따른다). 지우기 실패는 로그만 남긴다.
- 200 응답(일부 실패가 있어도 200):

```json
{
  "succeeded": 2, "failed": 1,
  "results": [
    {"number": 1, "title": "1화 시작", "status": "versioned", "reason": null, "missingImages": 0},
    {"number": 2, "title": "2화", "status": "partial", "reason": "이미지 1개를 가져오지 못했어요.", "missingImages": 1},
    {"number": 4, "title": "4화", "status": "failed", "reason": "앞 회차가 없어 등록할 수 없어요.", "missingImages": 0}
  ]
}
```

  `status`: `created`(새 회차) · `versioned`(기존 회차에 새 버전) · `partial`(저장했지만 이미지 일부 누락) · `failed`(저장 안 함). `succeeded`는 `failed`가 아닌 수다. 화면은 실패·부분 항목을 따로 보여 주고 전체 성공으로 표시하지 않는다.
- 등록은 공개·발행·학습 동의가 아니다(BR-03). 설정 추출(UC-04) 연결은 이번 범위 밖이다.

## 4. 원고 내보내기 (기능 18 · TXT/EPUB 원고 내보내기)

`GET /api/v1/works/{workId}/manuscript-export?format=txt|epub&source=draft|published[&episode=N]`

- 소유자만. `episode`가 없으면 작품 전체, 있으면 그 회차 하나.
- `source=draft`: 각 회차의 현재 초안(`EpisodeResponse.draft`). `source=published`: 발행본(`publishedVersionId`)이 있는 회차만.
- Fork 작품은 상속 회차(`inherited=true`)를 빼고 자기 회차만 내보낸다(UC-10 A8). `episode=N`이 상속 회차면 403.
- 내보낼 회차가 하나도 없으면 422 "내보낼 수 있는 회차가 없어요.". 잘못된 `format`·`source`는 422.
- TXT: `text/plain;charset=UTF-8`, UTF-8 BOM. 작품 전체면 첫 줄에 작품 제목. 회차마다 `제목\n\n본문`을 빈 줄 두 개로 구분하고 `[[image:...]]` 표식은 지운다(이미지 제외). 원고 기본 서식의 기호(`**`·`## `·`> `·`---` 등, DEC-48)는 원문 그대로 남아 다시 가져오면 서식이 유지된다.
- EPUB 3: `application/epub+zip`. 첫 항목 `mimetype`(무압축), `META-INF/container.xml`, OPF(제목=작품 제목, `dc:language=ko`, `dc:identifier=urn:uuid:<workId>`, `dcterms:modified`), `nav.xhtml`, 회차별 XHTML 챕터. 본문은 [원고 기본 서식 계약](manuscript-format-contract.md)(DEC-48)의 문법으로 그린다: 문단 줄마다 `<p>`, 소제목 `<h2>`(회차 제목이 `<h1>`), 연속한 인용 줄은 `<blockquote>` 하나 안에 줄마다 `<p>`, 구분선 `<hr/>`, 굵게 `<strong>`·기울임 `<em>`(겹칠 수 있다). 줄 앞뒤 공백을 떼고 빈 줄·공백뿐인 줄·내용이 빈 인용 줄은 내지 않으며, 글자는 XML 이스케이프하고 XML에 쓸 수 없는 문자는 뺀다. 서식 기호가 없는 원고의 출력은 서식 도입 전과 같다. `[[image:id]]`는 기존 원고 이미지 다운로드 권한 검사로 바이트를 읽어 챕터에 포함하고, 읽을 수 없으면 그 이미지만 뺀다. 줄 가운데에 낀 표식은 이전처럼 이미지로 빼고, 같은 줄의 나머지 글은 소제목·인용·구분선 없이 문단으로 낸다(굵게·기울임은 적용).
- `Content-Disposition: attachment; filename*=UTF-8''<작품 제목 또는 회차 제목>.<확장자>`(파일명에 쓸 수 없는 문자는 `_`).
- 회차 메모·설정은 포함하지 않는다.

## 5. 원고 이미지 목록·대체 텍스트·본문 참조 제거 (기능 16-C, 2026-11-09 사용자 확정)

- 저장: `content_image`에 `alt_text varchar(300) NOT NULL DEFAULT ''` 칼럼을 추가한다(`db/migration/contentimage/V2__content_image_alt_text.sql`, 원고 이미지 전용 Flyway 이력). 이미지마다 대체 텍스트 하나이며 수정하면 발행본 화면에도 바로 반영된다(버전별 값 없음).
- 목록(소유자): `GET /api/v1/works/{workId}/episodes/{number}/images` → `{"images":[{"id","filename","mediaType","byteSize","altText","createdAt","url","referenced"}]}`. 그 작품·회차에 올린 이미지(`work_id`·`episode_no` 일치)만 생성 순으로 반환한다. `url`은 기존 소유자 다운로드 경로, `referenced`는 현재 초안 본문에 `[[image:<id>]]`가 있는지다. 상속 회차는 빈 목록이다.
- 대체 텍스트 수정(소유자): `PATCH /api/v1/works/{workId}/episodes/{number}/images/{imageId}` · JSON `{"altText": "..."}` · CSRF 필요 → 200 목록 항목 한 건. 앞뒤 공백 제거 후 0~300자, 제어 문자(U+0000 포함) 금지 → 422. 다른 작품·회차의 이미지거나 소유자가 아니면 404.
- 공개 대체 텍스트: `GET /api/v1/public/works/{workId}/episodes/{number}/images` → `{"images":[{"id","altText"}]}`. 공개 작품의 발행본 본문이 참조하는 이미지만 반환한다(기존 공개 이미지 다운로드와 같은 공개 판단 재사용). 독자 화면은 이 값을 `img alt`로 쓰고, 없으면 기존 대체 문구를 쓴다.
- 본문 참조 제거: 서버 API를 새로 두지 않는다. 집필실 이미지 목록의 '본문에서 빼기'가 현재 초안 본문에서 그 표식을 지우고 기존 초안 저장(`PUT .../draft`, revision 검사)으로 저장한다. 이미지 파일은 저장 버전·발행본이 참조할 수 있으므로 지우지 않는다. 미저장 입력이 있으면 덮어쓰지 않고 먼저 저장하도록 안내한다.
- 연계: EPUB 가져오기는 `img alt`를 `altText`로 저장하고, EPUB 내보내기는 `altText`를 `img alt`로 쓴다.
- ponytail 한계: 참조되지 않는 이미지 파일은 계속 남는다(정리·삭제 API는 후속). 대체 텍스트는 버전별로 보존되지 않는다.

## 실행 연결

| 계층 | 위치 |
|---|---|
| Content | `ai.storyfork.content.manuscript` 패키지(Controller·Service·순수 파서/작성기, 원고 기본 서식 문법 `domain/ManuscriptFormat`). 첨부 파일명 수정은 기존 `attachment` 패키지 |
| 프런트 | `domain/repositories/ManuscriptRepository`·`domain/usecases/ManuscriptUseCase`·`data/content/HttpManuscriptRepository`, `MediaRepository.rename`. `/import` 실제 화면, 집필실 내보내기 패널, 설정 첨부 이름 변경 버튼 |
| mockup | 기존 데모 가져오기 화면 유지. 데모 집필실의 TXT 내보내기는 기존처럼 메모리 원고로 실제 TXT 파일을 만든다(초안 기준). EPUB·발행본 내보내기, 첨부 이름 변경, 원고 이미지 목록·대체 텍스트·공개 대체 텍스트 조회의 메모리 구현은 성공을 흉내 내지 않고 "데모에서는 지원하지 않아요" 오류를 낸다 |

## ponytail 한계

- 경계 조정은 인접 회차 합치기·제목 수정·제외만 지원하고 임의 줄에서 나누기는 지원하지 않는다. 필요하면 TXT 제목 줄을 고쳐 다시 올린다.
- 확정할 때 파일을 다시 올린다(최대 50MB 두 번 전송). 상태 저장이 필요해지면 가져오기 작업 테이블로 바꾼다.
- 실패 항목은 확정 응답에만 있고 화면을 떠나면 다시 볼 수 없다.
- EPUB 표·각주·스타일은 텍스트 문단으로만 가져온다. 내보내기 EPUB에 작가명은 넣지 않는다(Content에 회원 표시명이 없음).
- EPUB 가져오기는 서식을 되살리지 않는다(글자만 읽고 `<hr/>`는 사라진다). EPUB으로 내보낸 뒤 다시 가져오면 서식 기호가 없어진다(TXT는 유지).
- 내보내기 EPUB에는 스타일시트가 없어 소제목·인용·구분선의 모양은 읽는 앱의 기본값이다.

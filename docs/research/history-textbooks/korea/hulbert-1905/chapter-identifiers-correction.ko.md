# 헐버트 1905 한국사 장 식별자 메타데이터 정정

확인일: 2026-11-13 UTC. 원서 인쇄 표제와 Project Gutenberg(PG) 전사판의 식별자를 구별하기 위한 정정이다. 한국어 번역 본문과 영어 대본은 수정하지 않았다.

## 직접 확인한 근거

source-vol2-en.txt 624행은 Chapter I-A., 5218행은 Chapter X.다. 이는 PG 전사판의 표제다. 같은 파일의 전사자 주 17882–17884행은 다음을 명시한다.

- 두 번째 장은 Chapter XI로 잘못 인쇄되었으며 전사판에서는 Chapter I-A로 부른다.
- Chapter X의 표제는 XX로 잘못 인쇄되었다.

이 결론은 로컬 PG 전사자 주를 직접 읽은 데 근거한다. 1905년 원판 페이지 이미지를 새로 대조했다는 뜻은 아니다. 전사자 주는 원저의 역사 서술과 구분한다. 대본은 [PG 제2권](https://www.gutenberg.org/ebooks/52749)의 전사본이며 전체 텍스트는 source-vol2-en.txt에 보존되어 있다.

## 현재 집계와 범위

- 제1권 35개 + 제2권 28개 = 총 63개 내용 단위다. 제2권의 식별 순서는 PG 전사판의 I·I-A·II–XXVII를 따른다.
- I-A는 독립된 두 번째 내용 단위를 식별하지만 원서에 I-A라는 표제가 그대로 인쇄되었다는 뜻은 아니다. ‘원서 실제 표제 63개’라는 설명을 ‘내용 단위 63개’로 바로잡았다.
- 파일명 vol2-01a, 한국어 본문 장 표제, 장 순서 및 번역 범위는 유지했다. 제10장도 PG 기준 번호 X를 사용한다. 인쇄 표제 XI·XX를 현대 번역 본문에 새로 덮어쓰지 않았다.
- 현재 국가별 README, 관련 개별 머리말·QA, 네 통합본과 manifest를 갱신했다. 앞부분·인명·연대색인은 머리말만 정정했다. 과거 검수·교정 보고서는 원래 내용을 유지하고 작성 당시 기록임과 최신 정정 링크를 표시했다. 과거 해시를 최신 해시로 오인하지 않는다.
- 상위 README·READING-INDEX·CURRENT-COLLECTION은 수정하지 않았다. 기존 revisions 아래의 과거 백업도 그대로다.

## 백업과 불변 검증

변경할 기존 파일 모두를 먼저 revisions/pre-chapter-identifier-clarification/에 같은 이름으로 복사하고 전체 바이트 및 SHA-256 일치를 확인했다. 이 백업은 메타데이터 정정 직전 상태이며 최신 번역 대신 읽는 파일이 아니다.

- 63개 장 모두 TRANSLATION-BEGIN부터 TRANSLATION-END까지 바이트가 수정 전과 동일하다. 해당 경계 안의 장 표제·개요·산문·삽화 설명·목록 등을 함께 검사했다.
- 서문·소개, 표제·목차, 인명색인, 군주 연대색인은 각 번역 섹션 시작부터 파일 끝까지 바이트 불변이다. 일반색인 파일 전체도 변경하지 않았다.
- 네 통합본의 현재 구성파일 전체 바이트열이 각각 정확히 한 번 포함되고 순서·시작 및 끝 제외 오프셋·구간 해시가 모두 일치한다. 수록 파일 수는 고대 13, 제1권 36(서문·소개 포함), 제2권 28, 전2권 64(서문·소개 포함)다.
- 엄격한 UTF-8 해독과 BOM·대체문자 없음, 두 영어 원문 해시 불변을 확인했다. 이는 구조·바이트 보존 검사이며 전수 의미 교열이나 역사 감수 완료가 아니다.
- 전후 파일 크기·해시, 63개 장 본문 해시와 추가 번역 섹션 불변 근거는 [기계 대조 기록](chapter-identifiers-correction-manifest.json)에 기록했다.

## 현재 통합본

| 통합본 | 실제 bytes | SHA-256 |
|---|---:|---|
| [vol1-ancient-13-chapters.ko.draft.md](vol1-ancient-13-chapters.ko.draft.md) | 395896 | E15235CA836F118356F53311666E4507C17A966B79CD5638FCDF858634FD4FCD |
| [vol1-35-chapters.ko.draft.md](vol1-35-chapters.ko.draft.md) | 1189722 | 569DFF2C020E036ACADC2BB3EDD321F60DC27EFBDAAB93DAFAC6789FE58F2AD9 |
| [vol2-28-chapters.ko.draft.md](vol2-28-chapters.ko.draft.md) | 902493 | EF66795D35A7A269586804117D012572797DFF5D077E97BC0AC9C738FBE082FD |
| [korea-63-chapters.ko.draft.md](korea-63-chapters.ko.draft.md) | 2087690 | 68A49F3AFC8F926383A3575F0DB21675F70FAEAF988D89CCB9607F7B8BB2E5E3 |

## 보존한 원문

- source-vol1-en.txt: 1007640 bytes, SHA-256 DCCE85ACF41652C0BE4B9121F6C0A7AB30D327B98C9BE149AF4F9E9499CEF715.
- source-vol2-en.txt: 1003220 bytes, SHA-256 E0CB12FCF9DC105C627B85DDE2BB5511589A8F28E948624A733D84BE0AE4C8D4.

## 변경 파일

- [README.partial-ko.md](README.partial-ko.md)
- [frontmatter-index-manifest.json](frontmatter-index-manifest.json)
- [frontmatter-index-qa.ko.md](frontmatter-index-qa.ko.md)
- [korea-63-chapters-qa.ko.md](korea-63-chapters-qa.ko.md)
- [korea-63-chapters.ko.draft.md](korea-63-chapters.ko.draft.md)
- [korea-63-chapters.manifest.json](korea-63-chapters.manifest.json)
- [vol1-35-chapters-manifest.json](vol1-35-chapters-manifest.json)
- [vol1-35-chapters-qa.ko.md](vol1-35-chapters-qa.ko.md)
- [vol1-35-chapters.ko.draft.md](vol1-35-chapters.ko.draft.md)
- [vol1-ancient-10.translation-qa.md](vol1-ancient-10.translation-qa.md)
- [vol1-ancient-11.translation-qa.md](vol1-ancient-11.translation-qa.md)
- [vol1-ancient-12.translation-qa.md](vol1-ancient-12.translation-qa.md)
- [vol1-ancient-13-chapters.ko.draft.md](vol1-ancient-13-chapters.ko.draft.md)
- [vol1-ancient-13-chapters.translation-qa.md](vol1-ancient-13-chapters.translation-qa.md)
- [vol1-ancient-13.translation-qa.md](vol1-ancient-13.translation-qa.md)
- [vol1-independent-sample-review.ko.md](vol1-independent-sample-review.ko.md)
- [vol1-medieval-01.translation-qa.md](vol1-medieval-01.translation-qa.md)
- [vol1-medieval-02.translation-qa.md](vol1-medieval-02.translation-qa.md)
- [vol1-medieval-03.translation-qa.md](vol1-medieval-03.translation-qa.md)
- [vol1-preface-introduction.ko.draft.md](vol1-preface-introduction.ko.draft.md)
- [vol1-sample-correction.ko.md](vol1-sample-correction.ko.md)
- [vol1-vol2-frontmatter.ko.draft.md](vol1-vol2-frontmatter.ko.draft.md)
- [vol2-01.ko.draft.md](vol2-01.ko.draft.md)
- [vol2-01.translation-qa.md](vol2-01.translation-qa.md)
- [vol2-01a.ko.draft.md](vol2-01a.ko.draft.md)
- [vol2-01a.translation-qa.md](vol2-01a.translation-qa.md)
- [vol2-07.translation-qa.md](vol2-07.translation-qa.md)
- [vol2-08.translation-qa.md](vol2-08.translation-qa.md)
- [vol2-09.translation-qa.md](vol2-09.translation-qa.md)
- [vol2-10.ko.draft.md](vol2-10.ko.draft.md)
- [vol2-10.translation-qa.md](vol2-10.translation-qa.md)
- [vol2-13.ko.draft.md](vol2-13.ko.draft.md)
- [vol2-13.translation-qa.md](vol2-13.translation-qa.md)
- [vol2-14.ko.draft.md](vol2-14.ko.draft.md)
- [vol2-14.translation-qa.md](vol2-14.translation-qa.md)
- [vol2-15.ko.draft.md](vol2-15.ko.draft.md)
- [vol2-15.translation-qa.md](vol2-15.translation-qa.md)
- [vol2-16.ko.draft.md](vol2-16.ko.draft.md)
- [vol2-16.translation-qa.md](vol2-16.translation-qa.md)
- [vol2-17.ko.draft.md](vol2-17.ko.draft.md)
- [vol2-17.translation-qa.md](vol2-17.translation-qa.md)
- [vol2-18.ko.draft.md](vol2-18.ko.draft.md)
- [vol2-18.translation-qa.md](vol2-18.translation-qa.md)
- [vol2-19.ko.draft.md](vol2-19.ko.draft.md)
- [vol2-19.translation-qa.md](vol2-19.translation-qa.md)
- [vol2-20.ko.draft.md](vol2-20.ko.draft.md)
- [vol2-20.translation-qa.md](vol2-20.translation-qa.md)
- [vol2-21.ko.draft.md](vol2-21.ko.draft.md)
- [vol2-21.translation-qa.md](vol2-21.translation-qa.md)
- [vol2-28-chapters-qa.ko.md](vol2-28-chapters-qa.ko.md)
- [vol2-28-chapters.ko.draft.md](vol2-28-chapters.ko.draft.md)
- [vol2-28-chapters.manifest.json](vol2-28-chapters.manifest.json)
- [vol2-index-biographical-qa.ko.md](vol2-index-biographical-qa.ko.md)
- [vol2-index-biographical.ko.draft.md](vol2-index-biographical.ko.draft.md)
- [vol2-index-chronological.ko.draft.md](vol2-index-chronological.ko.draft.md)

본문63장 초안 저장과 부속자료 저장 상태는 그대로이며 전문 독립 번역 교열·한국사 감수는 미완료다. 이 정정은 장 식별자의 출처 설명을 바로잡은 것으로 원저의 역사적 오류를 수정하거나 새 내용을 번역한 작업이 아니다.

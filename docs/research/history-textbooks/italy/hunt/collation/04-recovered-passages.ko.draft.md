# 제4장 훼손 구절 복구 대조초안

작성일: 2026-11-13. William Hunt, History of Italy, Second Edition, Macmillan, 1883.

## 범위와 근거

기존 `04-qa.ko.md` 및 `04-main-prose.ko.draft.md`의 문맥 추정 1곳을 대조했다. 기존 Google 인쇄64/PDF81의 마지막 행 첫 단어에 검은 손상이 있음을 직접 확인했다. Toronto 인쇄64/PDF80의 같은 행은 온전히 읽히며 다음 인쇄65/PDF81의 문맥도 확인했다. OCR은 위치 탐색용으로만 사용했다.

- 기존 스캔: `../source-scan.pdf`.
- 대조 스캔: `../source-toronto-1883-scan.pdf`, SHA-256 `65697AE4B66BBF789C5E78214033868D7864B3EDFCDE2B365C5D1700EB0F3CA1`.
- PDF 쪽수는 파일 처음부터 1로 센 위치다. 기존 본문·QA·원문은 변경하지 않았다.

## 04-01. 제9절, 두 당파의 선물

- 위치: 인쇄64 마지막 두 행 / 기존 PDF81 / 새 PDF80.
- 이전 표시: `[문맥상 추정: 그는 두 당파가 겉으로나마 화해하도록 했으며, 양측 지도자들은 왕에게 큰 선물을 바치려고 서로 경쟁했다.]`

확인한 영문:

> He made both parties enter into an outward reconciliation, and the chiefs of both vied with one another in making him large presents.

수정 한국어:

그는 두 당파가 겉으로나마 화해하도록 했으며, 양측 지도자들은 왕에게 큰 선물을 바치려고 서로 경쟁했다.

판독 결과: 손상된 단어는 `both`이다. `the chiefs of both`가 선명하므로 기존 ‘양측 지도자들’이라는 번역을 유지할 수 있다. 이 문장의 결손은 대체 스캔으로 해소되었다.

남은 불확실성: 해당 문장의 문자 결손 없음. 주변 대관 날짜 등 역사적 진술을 정정하거나 검증한 작업은 아니다. 기존 본문에는 추정 표지가 아직 남아 있으며, 이 파일은 병합 전 교체 후보이다. 전문가 역사 감수와 한국어 최종 교열은 미완료다. 476년 이전 고대사·1874년 이후 현대사 공백과 파생 세계관의 구분은 유지한다. 앱·DB·학습 코퍼스 통합, 커밋·푸시는 하지 않았다.

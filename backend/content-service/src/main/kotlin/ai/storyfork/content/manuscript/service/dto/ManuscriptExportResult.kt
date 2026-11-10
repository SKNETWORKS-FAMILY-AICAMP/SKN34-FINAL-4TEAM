package ai.storyfork.content.manuscript.service.dto

/** 내보내기 파일. filename은 확장자까지 포함하고 파일명에 쓸 수 없는 문자는 `_`로 바뀐 값이다. */
class ManuscriptExportResult(val bytes: ByteArray, val contentType: String, val filename: String)

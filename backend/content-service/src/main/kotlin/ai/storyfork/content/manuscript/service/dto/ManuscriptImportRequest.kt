package ai.storyfork.content.manuscript.service.dto

/** 원고 등록 확정 요청. 같은 파일을 다시 보내며 items는 등록할 회차(제외한 회차는 뺀다)다. */
data class ManuscriptImportRequest(val rightsConfirmed: Boolean = false, val items: List<ManuscriptImportItem> = emptyList())

/** number는 작품의 목표 회차 번호, from·to는 미리보기와 같은 단위의 범위다. */
data class ManuscriptImportItem(val number: Int = 0, val title: String = "", val from: Int = 0, val to: Int = 0)

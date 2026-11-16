package ai.storyfork.content.manuscript.service.dto

/** 원고 미리보기. from(포함)·to(제외)는 unit 기준 위치이며 화면이 그대로 확정 요청에 쓴다. existingEpisodeCount는 상속 포함 현재 회차 수다. */
data class ManuscriptPreviewResponse(val format: String, val unit: String, val unitCount: Int, val existingEpisodeCount: Int, val episodes: List<ManuscriptPreviewEpisode>)

/** 미리보기의 회차 후보. charCount는 이미지 표식(46자)까지 센 본문 길이이고 excerpt는 이미지 대신 `[이미지]`를 쓴 앞 300자다. */
data class ManuscriptPreviewEpisode(val title: String, val from: Int, val to: Int, val charCount: Int, val excerpt: String, val imageCount: Int, val warnings: List<String>)

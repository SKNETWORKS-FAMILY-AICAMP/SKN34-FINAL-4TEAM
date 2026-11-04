package ai.storyfork.content.context.service.dto


data class SelectionResponse(val omittedCharacters: Int, val eligibleEpisodes: Int, val method: String = "source-excerpts", val note: String = "선택된 원문 발췌입니다. 전체 원고 요약이 아닙니다. 인물 시점은 허용 설정만 사용합니다.")

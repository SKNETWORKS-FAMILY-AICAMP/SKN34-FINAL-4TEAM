package ai.storyfork.content.reading.service.dto

/** 작품 하나의 독서 기록: 이어 읽기 위치(`lastEpisode`)와 연 적 있는 회차(오름차순). */
data class ReadingRecordResponse(val workId: String, val lastEpisode: Int, val readEpisodes: List<Int>, val updatedAt: String)

/** 본인의 독서 기록 목록. 가장 최근에 읽은 작품이 앞이다. */
data class ReadingListResponse(val records: List<ReadingRecordResponse>)

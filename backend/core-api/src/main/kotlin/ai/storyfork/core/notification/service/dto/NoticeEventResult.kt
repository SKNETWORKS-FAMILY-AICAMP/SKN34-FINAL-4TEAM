package ai.storyfork.core.notification.service.dto

/** 사건 처리 결과. 모두 정상 종료(ack)이며 잘못된 메시지는 InvalidNoticeEventException으로 구분한다. */
enum class NoticeEventResult { CREATED, DUPLICATE, SKIPPED_PREFERENCE, DROPPED_UNKNOWN_MEMBER }

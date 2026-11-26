package ai.storyfork.content.interest.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

/** 브로커로 보낼 알림 사건 한 건. id가 사건 계약의 eventId이고 [publishedAt]이 비어 있는 동안 발행 대기다. */
@Entity
@Table(name = "content_event_outbox")
class ContentEventOutboxEntity(
    @field:Id @field:Column(name = "id")
    var id: UUID = UUID(0, 0),
    @field:Column(name = "type")
    var type: String = "",
    @field:Column(name = "recipient_id")
    var recipientId: String = "",
    @field:Column(name = "target_type")
    var targetType: String = "",
    @field:Column(name = "target_id")
    var targetId: String = "",
    @field:Column(name = "occurred_at")
    var occurredAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "published_at")
    var publishedAt: Instant? = null,
    /** 알림 문구 재료(#941, 계약의 detail). 작품명 또는 세계관명이다. 비공개 원고 본문·개인정보는 싣지 않는다. */
    @field:Column(name = "detail_title")
    var detailTitle: String? = null,
    /** 회차 단위 사건의 회차 번호(#941). */
    @field:Column(name = "detail_episode")
    var detailEpisode: Int? = null,
    /** AI 변경 사건에서 바뀐 것을 가리키는 짧은 구절(#941, 예: 원고·플롯). */
    @field:Column(name = "detail_subject")
    var detailSubject: String? = null,
    /** 운영자 제한 사유(#941). 있을 때만 싣는다. */
    @field:Column(name = "detail_reason")
    var detailReason: String? = null,
)

package ai.storyfork.operations.notice.repository

import ai.storyfork.operations.notice.entity.NoticeEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

/** 공지 저장과 크기 제한 페이지 조회에 표준 JPA 저장소를 사용한다. */
interface NoticeRepository : JpaRepository<NoticeEntity, UUID>

package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import org.hibernate.annotations.Immutable

/** 소유자가 올린 설정 카드 대표 이미지(V8)다. 바이트는 객체 저장소에 있고 여기에는 키와 형식만 둔다. 올린 이미지는 바뀌지 않는다(교체는 새 이미지). `created_at`은 DB 기본값이 채운다. */
@Entity
@Table(name="setting_card_image", schema="worldstudio")
@Immutable
class SettingCardImage(
    @Id val id: UUID,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="object_key", columnDefinition="text", nullable=false) val objectKey: String,
    /** 이미지 형식(image/png·image/jpeg·image/webp). 업로드 바이트의 시그니처가 정한다. */
    @Column(name="content_type", columnDefinition="text", nullable=false) val contentType: String
)

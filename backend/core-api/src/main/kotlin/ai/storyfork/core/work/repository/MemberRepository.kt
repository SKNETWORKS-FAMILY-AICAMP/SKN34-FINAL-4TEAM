package ai.storyfork.core.work.repository

import ai.storyfork.core.work.entity.MemberEntity
import org.springframework.data.jpa.repository.*

@org.springframework.stereotype.Repository("contentMemberRepository")
interface MemberRepository : JpaRepository<MemberEntity, String> {

}

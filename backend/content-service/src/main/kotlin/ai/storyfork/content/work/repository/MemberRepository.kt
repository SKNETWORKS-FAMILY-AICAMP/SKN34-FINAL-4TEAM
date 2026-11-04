package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.MemberEntity
import org.springframework.data.jpa.repository.*

@org.springframework.stereotype.Repository("contentMemberRepository")
interface MemberRepository : JpaRepository<MemberEntity, String> {

}

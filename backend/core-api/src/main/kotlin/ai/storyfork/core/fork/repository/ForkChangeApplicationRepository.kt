package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkChangeApplicationEntity
import org.springframework.data.jpa.repository.*

interface ForkChangeApplicationRepository : JpaRepository<ForkChangeApplicationEntity, String> {

}

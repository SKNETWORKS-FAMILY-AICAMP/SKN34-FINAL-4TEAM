package ai.storyfork.operations._common.client

import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

data class ContentWork(val workId: UUID, val ownerId: UUID, val title: String, val restricted: Boolean)

/** Content internal work APIs; only the service token is sent, never a member Bearer. */
class ContentClient(private val http: RestClient) {
    fun work(workId: UUID): ContentWork = upstream {
        http.get().uri("/internal/v1/works/{id}", workId).retrieve().body<ContentWork>()
    }

    // ponytail: one unpaged call under the fixed 5s read timeout; add server-side q/kind/sort/page (work contract) when the list grows.
    fun works(): OperationsWorkList = upstream {
        http.get().uri("/internal/v1/works").retrieve().body<OperationsWorkList>()
    }

    fun restrict(workId: UUID): ContentWork = upstream {
        http.put().uri("/internal/v1/works/{id}/restriction", workId).retrieve().body<ContentWork>()
    }

    fun unrestrict(workId: UUID): ContentWork = upstream {
        http.delete().uri("/internal/v1/works/{id}/restriction", workId).retrieve().body<ContentWork>()
    }
}

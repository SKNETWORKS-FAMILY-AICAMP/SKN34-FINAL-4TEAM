package ai.storyfork.content.manuscript

import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper

/** 메모리 안의 가짜 HTTP(MockRestServiceServer)로 인덱스 최초 생성 판단만 검증한다. 실제 Elasticsearch는 쓰지 않는다. */
class ManuscriptIndexBootstrapIntegrationTest {
    private val builder = RestClient.builder().baseUrl("http://es")
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val index = ManuscriptElasticsearch(builder.build(), JsonMapper.builder().build(), "storyfork-manuscript-v1")
    private val definition = ClassPathResource("manuscript/manuscript-chunks-v1.json").getContentAsString(Charsets.UTF_8)

    private fun mapping(dims: Int = 384) = """{"storyfork-manuscript-v1":{"mappings":{"dynamic":"strict",
        "_meta":{"embedding_model":"intfloat/multilingual-e5-small","embedding_revision":"614241f622f53c4eeff9890bdc4f31cfecc418b3",
        "embedding_artifact":"onnx/model_qint8_avx512_vnni.onnx"},
        "properties":{"embedding":{"type":"dense_vector","dims":$dims,"similarity":"cosine","index_options":{"type":"int8_hnsw"}}}}}}"""

    private fun expectHead(status: HttpStatus) =
        server.expect(requestTo("http://es/storyfork-manuscript-v1")).andExpect(method(HttpMethod.HEAD)).andRespond(withStatus(status))

    private fun expectMapping(body: String) = server.expect(requestTo("http://es/storyfork-manuscript-v1/_mapping"))
        .andExpect(method(HttpMethod.GET)).andRespond(withSuccess(body, MediaType.APPLICATION_JSON))

    @Test
    fun `인덱스가 없으면 v1 매핑으로 만들고 검증한다`() {
        expectHead(HttpStatus.NOT_FOUND)
        server.expect(requestTo("http://es/storyfork-manuscript-v1")).andExpect(method(HttpMethod.PUT))
            .andExpect(content().json(definition))
            .andRespond(withSuccess("""{"acknowledged":true,"shards_acknowledged":true}""", MediaType.APPLICATION_JSON))
        expectMapping(mapping())

        index.ensureIndex(definition)

        server.verify()
    }

    @Test
    fun `기존 인덱스는 다시 만들지 않고 매핑만 검증한다`() {
        expectHead(HttpStatus.OK)
        expectMapping(mapping())

        index.ensureIndex(definition)

        server.verify()
    }

    @Test
    fun `기존 인덱스 매핑이 다르면 시작을 실패시킨다`() {
        expectHead(HttpStatus.OK)
        expectMapping(mapping(dims = 768))

        assertThrows(IllegalStateException::class.java) { index.ensureIndex(definition) }
    }

    @Test
    fun `샤드를 배정하지 못한 생성은 성공으로 보지 않는다`() {
        expectHead(HttpStatus.NOT_FOUND)
        server.expect(requestTo("http://es/storyfork-manuscript-v1")).andExpect(method(HttpMethod.PUT))
            .andRespond(withSuccess("""{"acknowledged":true,"shards_acknowledged":false}""", MediaType.APPLICATION_JSON))

        assertThrows(IllegalStateException::class.java) { index.ensureIndex(definition) }
    }
}

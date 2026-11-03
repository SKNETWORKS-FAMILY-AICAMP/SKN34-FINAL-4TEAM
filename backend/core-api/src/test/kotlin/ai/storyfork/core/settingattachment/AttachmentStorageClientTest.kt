package ai.storyfork.core.settingattachment

import ai.storyfork.core.settingattachment.client.AttachmentStorageClient
import ai.storyfork.core.settingattachment.client.dto.AttachmentObjectPayload
import ai.storyfork.core.settingattachment.domain.AttachmentFailure
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.retry.RetryPolicy
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client

class AttachmentStorageClientTest {
    @Test fun `SDK failures on upload download and delete become stable safe errors`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            exchange.requestBody.use { it.readAllBytes() }
            val bytes = "<Error><Code>ServiceUnavailable</Code><Message>private-storage-details</Message></Error>".toByteArray()
            exchange.sendResponseHeaders(503, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            S3Client.builder().region(Region.US_EAST_1).endpointOverride(URI.create("http://127.0.0.1:${server.address.port}"))
                .forcePathStyle(true).httpClientBuilder(UrlConnectionHttpClient.builder())
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("synthetic", "synthetic")))
                .overrideConfiguration { it.retryPolicy(RetryPolicy.none()) }.build().use { s3 ->
                    val storage = AttachmentStorageClient(s3, "private-bucket")
                    for (operation in listOf<() -> Unit>(
                        { storage.upload("unique-key", AttachmentObjectPayload("test".toByteArray(), "text/plain")) },
                        { storage.read("unique-key"); Unit }, { storage.delete("unique-key") },
                    )) {
                        val failure = assertThrows(AttachmentFailure::class.java, operation)
                        assertEquals(503, failure.status); assertEquals("ATTACHMENT_STORAGE_FAILURE", failure.code)
                        assertFalse(failure.message.contains("private-storage")); assertNull(failure.cause)
                    }
                }
        } finally { server.stop(0) }
    }
}

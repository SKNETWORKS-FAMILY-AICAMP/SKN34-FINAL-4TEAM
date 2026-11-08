package ai.storyfork.content.attachment

import ai.storyfork.content.attachment.client.AttachmentStorageClient
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.CreateBucketRequest
import software.amazon.awssdk.services.s3.model.HeadBucketRequest
import software.amazon.awssdk.services.s3.model.HeadBucketResponse
import software.amazon.awssdk.services.s3.model.NoSuchBucketException

class AttachmentBucketTest {
    @Test fun `missing local bucket is created once at startup`() {
        val s3 = mock(S3Client::class.java)
        `when`(s3.headBucket(any(HeadBucketRequest::class.java))).thenThrow(NoSuchBucketException.builder().build())
        AttachmentStorageClient(s3, "storyfork-setting-attachments").ensureBucket()
        verify(s3).createBucket(CreateBucketRequest.builder().bucket("storyfork-setting-attachments").build())
    }

    @Test fun `existing bucket is left as is`() {
        val s3 = mock(S3Client::class.java)
        `when`(s3.headBucket(any(HeadBucketRequest::class.java))).thenReturn(HeadBucketResponse.builder().build())
        AttachmentStorageClient(s3, "storyfork-setting-attachments").ensureBucket()
        verify(s3, never()).createBucket(any(CreateBucketRequest::class.java))
    }
}

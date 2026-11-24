package ai.storyfork.content.imagegeneration
import ai.storyfork.content.imagegeneration.entity.ImageJob
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
class ImageJobTest {
 @Test fun `duplicate claim cannot run model twice`() {
  val job=ImageJob()
  assertTrue(job.claim())
  assertFalse(job.claim())
 }
 @Test fun `expired queued delivery is never started`() {
  val job=ImageJob(updatedAt=java.time.Instant.now().minusSeconds(301))
  assertFalse(job.claim())
  assertEquals("interrupted",job.status)
 }
 @Test fun `late callback cannot overwrite interrupted task`() {
  val job=ImageJob()
  job.status="interrupted"
  assertFalse(job.claim())
  assertFalse(job.running())
 }
}

package ai.storyfork.core.auth

import ai.storyfork.core.auth.entity.AuthSignupChallenge
import ai.storyfork.core.auth.repository.SignupChallengeRepository
import jakarta.persistence.EntityManager
import jakarta.persistence.EntityManagerFactory
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.AdditionalAnswers.delegatesTo
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.data.jpa.repository.support.JpaEntityInformation
import org.springframework.data.jpa.repository.support.SimpleJpaRepository

class SignupCollisionFixtureTest {
    @Test
    fun `collision barrier completes both merge lookups before either insert is flushed`() {
        val manager = mock(EntityManager::class.java)
        `when`(manager.entityManagerFactory).thenReturn(mock(EntityManagerFactory::class.java))
        @Suppress("UNCHECKED_CAST")
        val metadata = mock(JpaEntityInformation::class.java) as JpaEntityInformation<AuthSignupChallenge, String>
        val repository = SimpleJpaRepository<AuthSignupChallenge, String>(metadata, manager)
        val merges = AtomicInteger()
        doAnswer {
            merges.incrementAndGet()
            it.arguments[0]
        }.`when`(manager).merge(any(AuthSignupChallenge::class.java))
        doAnswer {
            assertEquals(2, merges.get(), "Both merge lookups must finish before flushing an insert")
            null
        }.`when`(manager).flush()
        val delegate = delegatesTo<Any?>(repository)
        val serialSaveAndFlush = Any()
        val challenges = mock(SignupChallengeRepository::class.java) { invocation ->
            when (invocation.method.name) {
                "lockByEmail" -> null
                // A valid schedule: the first saveAndFlush completes before the second merge starts.
                "saveAndFlush" -> synchronized(serialSaveAndFlush) { delegate.answer(invocation) }
                else -> delegate.answer(invocation)
            }
        }
        forceSignupInsertCollision(challenges)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val requests = (1..2).map { attempt -> pool.submit {
                assertNull(challenges.lockByEmail("race@example.invalid"))
                challenges.saveAndFlush(AuthSignupChallenge("race@example.invalid", "hash", "Reader", "$attempt", Instant.MAX))
            } }
            requests.forEach { it.get(10, TimeUnit.SECONDS) }
            assertEquals(2, merges.get())
        } finally {
            pool.shutdownNow()
        }
    }
}

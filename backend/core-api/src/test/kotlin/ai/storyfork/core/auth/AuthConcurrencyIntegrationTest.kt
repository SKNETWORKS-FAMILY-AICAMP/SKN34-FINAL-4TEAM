package ai.storyfork.core.auth

import ai.storyfork.core.auth.service.ProfileService
import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.dto.EmailRequest
import ai.storyfork.core.auth.service.dto.LoginRequest
import ai.storyfork.core.auth.service.dto.NicknameRequest
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.doAnswer
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean
import ai.storyfork.core.auth.service.dto.ResetRequest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.verify
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class AuthConcurrencyIntegrationTest {
    @Autowired lateinit var sessions: SessionService
    @Autowired lateinit var profiles: ProfileService
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var transactionManager: PlatformTransactionManager
    @MockitoBean lateinit var mail: JavaMailSender
    @MockitoSpyBean lateinit var passwords: PasswordEncoder

    private fun member(): String {
        val email = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)",
            UUID.randomUUID(), email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        return email
    }

    @Test
    fun `wrong password verification does not lock out other member operations`() {
        val email = member()
        val id = jdbc.queryForObject("select id from auth_member where email = ?", UUID::class.java, email)!!
        val checking = CountDownLatch(1)
        val release = CountDownLatch(1)
        doAnswer { invocation ->
            checking.countDown()
            assertTrue(release.await(10, TimeUnit.SECONDS))
            BCryptPasswordEncoder().matches(invocation.getArgument(0), invocation.getArgument(1))
        }.`when`(passwords).matches(eq("wrong-password"), anyString())
        val pool = Executors.newFixedThreadPool(2)
        try {
            val login = pool.submit<Any?> { sessions.login(LoginRequest(email, "wrong-password"), "Invalid login") }
            assertTrue(checking.await(5, TimeUnit.SECONDS))
            val rename = pool.submit { profiles.nickname(id, NicknameRequest("Updated reader")) }
            rename.get(2, TimeUnit.SECONDS)
            assertEquals("Updated reader", jdbc.queryForObject("select nickname from auth_member where id = ?", String::class.java, id))
            release.countDown()
            assertNull(login.get(5, TimeUnit.SECONDS))
            assertEquals(0, jdbc.queryForObject("select count(*) from auth_session where member_id = ?", Int::class.java, id))
        } finally {
            release.countDown()
            pool.shutdown()
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS))
        }
    }

    @Test
    fun `login cannot create a session with the old password while reset commits`() {
        val email = member()
        profiles.forgotPassword(EmailRequest(email))
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        val pool = Executors.newSingleThreadExecutor()
        try {
            val started = CountDownLatch(1)
            val login = TransactionTemplate(transactionManager).execute {
                profiles.resetPassword(ResetRequest(token, "new-password"))
                val pending = pool.submit<Any?> {
                    started.countDown()
                    sessions.login(LoginRequest(email, "test-password"), "Concurrent login")
                }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                assertThrows(TimeoutException::class.java) { pending.get(200, TimeUnit.MILLISECONDS) }
                pending
            }!!
            assertNull(login.get(5, TimeUnit.SECONDS))
            assertEquals(0, jdbc.queryForObject("select count(*) from auth_session where member_id = (select id from auth_member where email = ?)", Int::class.java, email))
            assertNotNull(sessions.login(LoginRequest(email, "new-password"), "New password"))
        } finally { pool.shutdownNow() }
    }

    @Test
    fun `login rejects an email reassigned to another identity during password verification`() {
        val email = member()
        val replacement = UUID.randomUUID()
        val checking = CountDownLatch(1)
        val release = CountDownLatch(1)
        doAnswer { invocation ->
            checking.countDown()
            assertTrue(release.await(10, TimeUnit.SECONDS))
            BCryptPasswordEncoder().matches(invocation.getArgument(0), invocation.getArgument(1))
        }.`when`(passwords).matches(eq("test-password"), anyString())
        val pool = Executors.newFixedThreadPool(2)
        try {
            val login = pool.submit<Any?> { sessions.login(LoginRequest(email, "test-password"), "Concurrent login") }
            assertTrue(checking.await(5, TimeUnit.SECONDS))
            val reassigned = pool.submit {
                TransactionTemplate(transactionManager).executeWithoutResult {
                    val oldEmail = "${UUID.randomUUID()}@example.invalid"
                    jdbc.update("update auth_member set email = ? where email = ?", oldEmail, email)
                    // Identical hashes deliberately isolate identity revalidation from the hash check.
                    jdbc.update("insert into auth_member(id,email,password_hash,nickname) select ?,?,password_hash,nickname from auth_member where email = ?", replacement, email, oldEmail)
                }
            }
            reassigned.get(2, TimeUnit.SECONDS)
            release.countDown()
            assertNull(login.get(5, TimeUnit.SECONDS))
            assertEquals(0, jdbc.queryForObject("select count(*) from auth_session where member_id = ?", Int::class.java, replacement))
            assertEquals(replacement.toString(), sessions.login(LoginRequest(email, "test-password"), "Replacement")?.user?.id)
        } finally {
            release.countDown()
            pool.shutdown()
            assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS))
        }
    }

    @Test
    fun `refresh waits for logout and cannot rotate a revoked session`() {
        val token = requireNotNull(sessions.login(LoginRequest(member(), "test-password"), "Device")).refreshToken
        val pool = Executors.newSingleThreadExecutor()
        try {
            val started = CountDownLatch(1)
            val refresh = TransactionTemplate(transactionManager).execute {
                assertTrue(sessions.logout(token))
                val pending = pool.submit<Any?> {
                    started.countDown()
                    sessions.refresh(token)
                }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                assertThrows(TimeoutException::class.java) { pending.get(200, TimeUnit.MILLISECONDS) }
                pending
            }!!
            assertNull(refresh.get(5, TimeUnit.SECONDS))
        } finally { pool.shutdownNow() }
    }

    @Test
    fun `logout waits for rotation and revokes the replacement refresh token`() {
        val token = requireNotNull(sessions.login(LoginRequest(member(), "test-password"), "Device")).refreshToken
        val pool = Executors.newSingleThreadExecutor()
        try {
            val started = CountDownLatch(1)
            var replacement: String? = null
            val logout = TransactionTemplate(transactionManager).execute {
                replacement = requireNotNull(sessions.refresh(token)).refreshToken
                val pending = pool.submit<Boolean> {
                    started.countDown()
                    sessions.logout(token)
                }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                assertThrows(TimeoutException::class.java) { pending.get(200, TimeUnit.MILLISECONDS) }
                pending
            }!!
            assertTrue(logout.get(5, TimeUnit.SECONDS))
            assertNull(sessions.refresh(replacement))
        } finally { pool.shutdownNow() }
    }
}

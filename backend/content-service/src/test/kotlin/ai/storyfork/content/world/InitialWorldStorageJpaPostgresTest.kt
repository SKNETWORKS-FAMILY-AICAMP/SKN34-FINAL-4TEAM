package ai.storyfork.content.world

import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.test.util.TestPropertyValues
import org.springframework.context.annotation.AnnotationConfigApplicationContext
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL", matches=".+")
class InitialWorldStorageJpaPostgresTest {
    @Test fun `existing persistence unit roundtrips analysis review and generated IDs across restart`() {
        WorldStudioPostgresFixture("independent").use { db ->
            val world=UUID.randomUUID(); val actor=UUID.randomUUID()
            val analysis=UUID.randomUUID(); val candidate=UUID.randomUUID(); val app=UUID.randomUUID(); val generated=UUID.randomUUID()
            fun context()=AnnotationConfigApplicationContext().apply {
                TestPropertyValues.of("DATABASE_URL=${db.url}",
                    "DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
                    "DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}").applyTo(this)
                register(ai.storyfork.content._common.config.ContentDatabaseConfig::class.java,WorldStudioConfig::class.java)
                refresh()
            }
            context().use { ctx ->
                db.connect().use { c -> WorldStudioPostgresFixture.sql(c,"INSERT INTO worldstudio.world(id,owner_subject) VALUES ('$world','$actor')") }
                val tx=TransactionTemplate(ctx.getBean("worldStudioTransactionManager",PlatformTransactionManager::class.java))
                tx.executeWithoutResult {
                    ctx.getBean(InitialWorldAnalysisRepository::class.java).saveAndFlush(InitialWorldAnalysis(
                        id=analysis,worldId=world,requestKey="one",requestHash="a".repeat(64),draftRevision=2,relationshipVersion=3,
                        inputSnapshot=mapOf("sources" to listOf(mapOf("text" to "홍😀\r\n길동"))),deadline=Instant.now().plusSeconds(90)))
                    val content=mapOf("type" to "fact","provenance" to "ai_extraction","evidence" to listOf(mapOf("quote" to "홍😀")))
                    ctx.getBean(InitialWorldCandidateRepository::class.java).saveAndFlush(InitialWorldCandidate(
                        id=candidate,worldId=world,analysisId=analysis,localRef="fact-1",content=content))
                    ctx.getBean(InitialWorldDecisionRepository::class.java).saveAndFlush(InitialWorldDecision(
                        worldId=world,analysisId=analysis,candidateId=candidate,sequence=1,action="approve",actorId=actor,content=content))
                    ctx.getBean(InitialWorldApplicationRepository::class.java).saveAndFlush(InitialWorldApplication(
                        id=app,worldId=world,analysisId=analysis,requestKey="apply-one",requestHash="b".repeat(64),
                        baseDraftRevision=2,relationshipVersion=3,additionPayload=mapOf("replace" to false)))
                    ctx.getBean(InitialWorldApplicationItemRepository::class.java).saveAndFlush(InitialWorldApplicationItem(
                        worldId=world,analysisId=analysis,applicationId=app,candidateId=candidate,decisionSequence=1,
                        generatedId=generated,generatedKind="card"))
                }
                tx.executeWithoutResult {
                    val row=ctx.getBean(InitialWorldAnalysisRepository::class.java).findById(analysis).orElseThrow()
                    row.executionStatus="completed";row.output=mapOf("candidates" to emptyList<Any>())
                    val receipt=ctx.getBean(InitialWorldApplicationRepository::class.java).findById(app).orElseThrow()
                    receipt.status="unknown"
                }
            }
            context().use { ctx ->
                val row=ctx.getBean(InitialWorldAnalysisRepository::class.java).findById(analysis).orElseThrow()
                assertEquals("completed",row.executionStatus)
                assertEquals(mapOf("sources" to listOf(mapOf("text" to "홍😀\r\n길동"))),row.inputSnapshot)
                assertEquals(1L,row.lockVersion)
                assertEquals("approved",ctx.getBean(InitialWorldDecisionRepository::class.java).findAll().single().state)
                assertEquals(generated,ctx.getBean(InitialWorldApplicationItemRepository::class.java).findAll().single().generatedId)
                assertEquals("unknown",ctx.getBean(InitialWorldApplicationRepository::class.java).findById(app).orElseThrow().status)
            }
        }
    }
}

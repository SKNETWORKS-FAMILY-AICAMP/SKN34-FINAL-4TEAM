package ai.storyfork.content.world.relationship

import java.net.URI
import java.util.concurrent.TimeUnit
import org.neo4j.driver.AuthTokens
import org.neo4j.driver.Config
import org.neo4j.driver.GraphDatabase
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.worldstudio.enabled"],havingValue="true")
class Neo4jRelationshipConfig {
    @Bean(destroyMethod="close")
    fun relationshipDriver(@Value("\${app.worldstudio.neo4j.uri}") uri:String,
        @Value("\${app.worldstudio.neo4j.username}") username:String,
        @Value("\${app.worldstudio.neo4j.password}") password:String)=run {
        val address=try { URI.create(uri) } catch(_:IllegalArgumentException) { throw IllegalArgumentException("Invalid Neo4j URI") }
        require(address.scheme in setOf("bolt","bolt+s","neo4j","neo4j+s") && address.userInfo==null)
        require(username.isNotBlank() && password.isNotBlank()) { "Neo4j credentials are required when WorldStudio is enabled" }
        GraphDatabase.driver(uri,AuthTokens.basic(username,password),Config.builder()
            .withConnectionTimeout(3,TimeUnit.SECONDS).withConnectionAcquisitionTimeout(3,TimeUnit.SECONDS)
            .withMaxTransactionRetryTime(0,TimeUnit.SECONDS).build())
    }
}

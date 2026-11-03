package ai.storyfork.core.world

import ai.storyfork.core.world.repository.WorldStudioStore
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.support.JdbcTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** Local studio storage owns its connection; it does not register or replace Core's DataSource. */
@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class WorldStudioConfig {
 @Bean fun worldStudioStore(mapper:JsonMapper,@Value("\${STUDIO_DB_URL}") url:String):WorldStudioStore {
  require(url.startsWith("jdbc:h2:file:") || url.startsWith("jdbc:h2:mem:")) {"Local studio requires an explicit embedded H2 URL"}
  val source=DriverManagerDataSource(url,"sa","")
  return WorldStudioStore(JdbcTemplate(source),mapper,TransactionTemplate(JdbcTransactionManager(source)))
 }
}

package ai.storyfork.core.world

import ai.storyfork.core.world.repository.WorldStudioStore
import javax.sql.DataSource
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.util.UUID

class WorldStudioConfigTest {
 private val context=ApplicationContextRunner().withUserConfiguration(WorldStudioConfig::class.java,MapperConfig::class.java)
 @Configuration(proxyBeanMethods=false)
 class MapperConfig {
  @Bean fun mapper():JsonMapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
 }
 @Test fun disabledStudioDoesNotRequireDatabaseOrRegisterStorage() {
  context.run { assertNull(it.startupFailure);assertEquals(0,it.getBeansOfType(WorldStudioStore::class.java).size);assertEquals(0,it.getBeansOfType(DataSource::class.java).size) }
 }
 @Test fun enabledStudioOwnsStorageWithoutReplacingCoreDataSource() {
  val core=DriverManagerDataSource("jdbc:h2:mem:core-${UUID.randomUUID()};DB_CLOSE_DELAY=-1","sa","")
  context.withBean(DataSource::class.java,{core}).withPropertyValues("STUDIO_ENABLED=true","STUDIO_DB_URL=jdbc:h2:mem:studio-${UUID.randomUUID()};DB_CLOSE_DELAY=-1").run {
   assertNull(it.startupFailure)
   assertSame(core,it.getBean(DataSource::class.java))
   assertEquals(1,it.getBeansOfType(DataSource::class.java).size)
   assertNotNull(it.getBean(WorldStudioStore::class.java))
   assertEquals(0,JdbcTemplate(core).queryForObject("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='STUDIO_WORLD'",Int::class.java))
  }
 }
}

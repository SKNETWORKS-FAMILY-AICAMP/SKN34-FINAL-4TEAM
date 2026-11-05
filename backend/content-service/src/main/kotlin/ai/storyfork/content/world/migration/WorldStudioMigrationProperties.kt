package ai.storyfork.content.world.migration

import java.net.URI

// Spring과 Auth/Content를 기동하지 않는 배포 전용 명령의 입력 경계다.
class WorldStudioMigrationProperties private constructor(
    val url: String, val user: String, val password: String, val database: String,
) {
    companion object {
        fun from(environment: Map<String, String>): WorldStudioMigrationProperties {
            fun required(key: String) = environment[key]?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("Required migration setting missing")
            require(required("WORLDSTUDIO_MIGRATION_ENVIRONMENT") == "development")
            required("WORLDSTUDIO_BACKUP_RESTORE_REFERENCE")
            val url = required("CONTENT_DATABASE_URL")
            val user = required("CONTENT_DATABASE_USER")
            val password = required("CONTENT_DATABASE_PASSWORD")
            require(url == required("WORLDSTUDIO_EXPECTED_DATABASE_URL"))
            require(user == required("WORLDSTUDIO_EXPECTED_DATABASE_USER"))
            require(url.startsWith("jdbc:postgresql://"))
            val uri = URI(url.removePrefix("jdbc:"))
            require(uri.host != null && uri.userInfo == null && uri.fragment == null)
            require(uri.port == -1 || uri.port in 1..65535)
            require(uri.path.matches(Regex("/[a-zA-Z0-9_-]+")))
            // 접속 계정/비밀번호는 URL 대신 별도 환경변수로만 전달한다.
            require(!Regex("(?i)(^|&)(user|password)=").containsMatchIn(uri.rawQuery.orEmpty()))
            return WorldStudioMigrationProperties(url, user, password, uri.path.removePrefix("/"))
        }
    }
}

package ai.storyfork.content.attachment

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("app.setting-attachments")
data class AttachmentProperties(var bucket: String = "", var region: String = "us-east-1", var endpoint: String = "")

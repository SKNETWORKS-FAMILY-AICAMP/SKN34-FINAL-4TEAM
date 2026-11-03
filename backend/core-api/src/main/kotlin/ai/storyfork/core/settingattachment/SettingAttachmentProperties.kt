package ai.storyfork.core.settingattachment

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("app.setting-attachments")
data class SettingAttachmentProperties(var bucket: String = "", var region: String = "us-east-1", var endpoint: String = "")

package ai.storyfork.content.world

import ai.storyfork.content.world.entity.*
import ai.storyfork.content.world.domain.Setting
import ai.storyfork.content.world.service.toReadingResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PublicWorldReadingTest {
    @Test fun `public wiki resolves properties at epoch and excludes future knowledge and event links`() {
        val detail=SettingReadingDetailEntity(settingVersionId="v",sourceKey="char:리안",wikiCategory="char",
            properties=mutableListOf(ReadingProperty(0,"상태","시작"),ReadingProperty(2,"상태","속삭임"),ReadingProperty(3,"상태","미래"),ReadingProperty(0,"비공개","근거 없음",null)),
            links=mutableListOf(ReadingLink("visible","계기"),ReadingLink("future","복선")),
            knowledge=mutableListOf(ReadingKnowledge("공개",1,1),ReadingKnowledge("비공개",1,null),ReadingKnowledge("미래",3,3)))
        val response=toReadingResponse(Setting(id="c",versionId="v",name="리안",content="견습",category="인물"),detail,2,setOf("visible"))
        assertEquals(listOf("속삭임"),response.properties.map {it.value})
        assertEquals(listOf("공개"),response.knowledge.map {it.text})
        assertEquals(listOf("visible"),response.links.map {it.to})
    }
    @Test fun `fork source epoch and explicit property disclosure remain capped after own episodes`() {
        val detail=SettingReadingDetailEntity(sourceBasisEpisode=1,properties=mutableListOf(
            ReadingProperty(0,"상태","첫 장면"),ReadingProperty(2,"상태","원작 미래"),ReadingProperty(0,"관계","미래 인물",2)),
            knowledge=mutableListOf(ReadingKnowledge("미래 지식",2,2)))
        val setting=Setting(id="c",versionId="v",name="인물",content="본문",category="인물")
        val response=toReadingResponse(setting,detail,3,emptySet())
        assertEquals(listOf("첫 장면"),response.properties.map {it.value})
        assertTrue(response.knowledge.isEmpty())
    }
    @Test fun `new following Forks cap rich properties at source basis without imported metadata`() {
        val detail=SettingReadingDetailEntity(properties=mutableListOf(ReadingProperty(0,"상태","시작"),ReadingProperty(2,"상태","미래")))
        val response=toReadingResponse(Setting(id="c",versionId="v",name="인물",content="본문",category="인물"),detail,3,emptySet(),sourceBasis=1)
        assertEquals(listOf("시작"),response.properties.map {it.value})
    }
}

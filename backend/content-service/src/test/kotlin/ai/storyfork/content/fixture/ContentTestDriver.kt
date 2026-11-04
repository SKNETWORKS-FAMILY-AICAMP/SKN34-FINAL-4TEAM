package ai.storyfork.content.fixture

import ai.storyfork.content.fixture.model.*
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import tools.jackson.databind.json.JsonMapper

/** Test-only adapter keeps the pre-refactor assertions while exercising the distinct real services. */
class ContentTestDriver(
    private val works: ai.storyfork.content.work.service.WorkService,
    private val episodes: ai.storyfork.content.episode.service.EpisodeService,
    private val versions: ai.storyfork.content.episode_version.service.EpisodeVersionService,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val world: ai.storyfork.content.world.service.WorldService,
    private val forks: ai.storyfork.content.fork.service.ForkService,
    private val context: ai.storyfork.content.context.service.ContextService,
    private val proposals: ai.storyfork.content.proposal.service.ProposalService,
    private val mapper: JsonMapper,
) {
    private inline fun <reified T> convert(value: Any): T = mapper.convertValue(value,T::class.java)
    fun create(owner: String,data: CreateWorkRequest): WorkResponse = convert(works.create(owner,convert(data)))
    fun read(id: String,owner: String): WorkResponse = convert(works.read(id,owner))
    fun publicRead(id: String): WorkResponse = convert(works.publicRead(id))
    fun history(id: String,owner: String): HistoryResponse = convert(works.history(id,owner))
    fun edit(id: String,owner: String,data: DraftRequest): Draft = convert(versions.saveCurrent(id,owner,convert(data)).draft)
    fun policy(id: String,owner: String,data: PolicyRequest): WorkResponse = convert(works.policy(id,owner,convert(data)))
    fun publish(id: String,owner: String,data: PublishRequest): WorkResponse {
        publication.publishCurrent(id,owner,convert(data));return read(id,owner)
    }
    fun createEpisode(id: String,owner: String,data: CreateWorkRequest): WritingEpisode = convert(episodes.create(id,owner,ai.storyfork.content.episode.service.dto.CreateEpisodeRequest(data.title)))
    fun writing(id: String,owner: String,number: Int): WritingEpisode = convert(episodes.read(id,owner,number))
    fun writingList(id: String,owner: String): List<WritingEpisode> = episodes.list(id,owner).items.map {convert(it)}
    fun writeEpisode(id: String,owner: String,number: Int,data: DraftRequest,saveVersion: Boolean): WritingEpisode =
        convert(if(saveVersion) versions.save(id,owner,number,convert(data)) else episodes.update(id,owner,number,convert(data)))
    fun restoreEpisode(id: String,owner: String,number: Int,data: RevertRequest): WritingEpisode = convert(versions.restore(id,owner,number,convert(data)))
    fun publishEpisode(id: String,owner: String,number: Int,data: PublishRequest): WritingEpisode = convert(publication.publishEpisode(id,owner,number,convert(data)))
    fun world(id: String,owner: String): WorldView = convert(world.read(id,owner))
    fun saveSetting(id: String,sid: String,owner: String,data: SettingRequest): WorldView = convert(world.saveDraft(id,sid,owner,convert(data)))
    fun commitSetting(id: String,sid: String,owner: String,expected: Int): WorldView = convert(world.commit(id,sid,owner,expected))
    fun revertSetting(id: String,sid: String,owner: String,data: RevertRequest): WorldView = convert(world.revert(id,sid,owner,convert(data)))
    fun fork(id: String,owner: String,data: ForkRequest): WorkResponse = convert(forks.create(id,owner,convert(data)))
    fun change(id: String,owner: String,data: ChangeRequest): WorldView = convert(forks.decideChange(id,owner,convert(data)))
    fun readContext(id: String,owner: String?,episode: Int,query: String,character: String): StoryContext = convert(context.read(id,owner,ai.storyfork.content.context.service.dto.ContextRequest(episode,query,character)))
    fun generationRequest(id: String,owner: String,episode: Int,query: String,character: String) = ai.storyfork.content.proposal.client.dto.GenerationPayload(context.read(id,owner,ai.storyfork.content.context.service.dto.ContextRequest(episode,query,character)),query)
    fun propose(id: String,owner: String,data: ProposalRequest): Proposal = convert(proposals.propose(id,owner,convert(data)))
    fun accept(id: String,pid: String,owner: String,revision: Int): Draft = convert(proposals.accept(id,pid,owner,revision))
}

@TestConfiguration(proxyBeanMethods=false)
class ContentTestConfig {
    @Bean fun testDriver(works: ai.storyfork.content.work.service.WorkService,episodes: ai.storyfork.content.episode.service.EpisodeService,
        versions: ai.storyfork.content.episode_version.service.EpisodeVersionService,publication: ai.storyfork.content.publication.service.PublicationService,
        world: ai.storyfork.content.world.service.WorldService,forks: ai.storyfork.content.fork.service.ForkService,
        context: ai.storyfork.content.context.service.ContextService,proposals: ai.storyfork.content.proposal.service.ProposalService,mapper: JsonMapper) =
        ContentTestDriver(works,episodes,versions,publication,world,forks,context,proposals,mapper)
}

package ai.storyfork.core.content.service

import ai.storyfork.core.content.client.GenerationClient
import ai.storyfork.core.content.controller.dto.*
import ai.storyfork.core.content.domain.*
import ai.storyfork.core.content.repository.ContentRepository
import tools.jackson.databind.json.JsonMapper

class ContentService(private val repository: ContentRepository, private val ai: GenerationClient, private val mapper: JsonMapper) {
    private fun get(id: String) = repository.find(id) ?: throw ContentFailure(404,"작품을 찾을 수 없어요.")
    private fun own(id: String, owner: String): ContentWork = get(id).also { checkContent(it.ownerId==owner,404,"작품을 찾을 수 없어요.") }
    private fun source(w: ContentWork) = w.source?.let { get(it.workId) }
    private fun view(w: ContentWork, public: Boolean = false) = WorkResponse(w.id,w.title,w.summary,w.visibility,w.allowFork,w.allowForkPublication,w.source,w.episodes,if(public) null else w.draft)
    private fun revision(w: ContentWork, expected: Int) = checkContent(w.draft.revision==expected,409,"원고가 변경됐어요. 최신 데이터를 불러와 주세요.")
    private fun worldRevision(w: ContentWork, expected: Int) = checkContent(w.world.revision==expected,409,"설정집이 변경됐어요. 최신 데이터를 불러와 주세요.")
    private fun checkpoint(w: ContentWork): Version = Version(title=w.draft.title,body=w.draft.body,revision=w.draft.revision,episode=w.episodes.size+1).also { w.versions.add(it) }
    private fun context(w: ContentWork, episode: Int, query: String, character: String, public: Boolean = false): StoryContext {
        val result = buildContext(w,effectiveHistory(w,source(w)),episode,query,character,public)
        checkContent(mapper.writeValueAsString(result).length <= 60000,message="문맥 한도를 넘어요. 회차 또는 인물 범위를 좁혀 주세요.")
        return result
    }
    fun writingList(id: String,owner: String) = repository.transaction {
        own(id,owner); repository.writingNumbers(id).mapNotNull { repository.writing(id,it) }
    }
    fun writing(id: String,owner: String,number: Int) = repository.transaction {
        own(id,owner); repository.writing(id,number) ?: throw ContentFailure(404,"회차를 찾을 수 없어요.")
    }
    private fun editable(id: String,number: Int,expected: Int): WritingEpisode {
        val e=repository.writing(id,number) ?: throw ContentFailure(404,"회차를 찾을 수 없어요.")
        checkContent(!e.inherited,403,"원작 기준 회차는 수정할 수 없어요.")
        checkContent(e.draft.revision==expected,409,"다른 편집이 저장됐어요. 입력을 보관하고 최신 원고를 다시 불러와 주세요.")
        return e
    }
    fun createEpisode(id: String,owner: String,data: CreateWorkRequest) = repository.transaction {
        own(id,owner); checkContent(data.title.isNotBlank() && data.title.length<=120,message="회차 제목을 확인해 주세요.")
        val number=(repository.writingNumbers(id).maxOrNull() ?: 0)+1
        repository.writeDraft(id,number,Draft(data.title.trim()))
        repository.writing(id,number)!!
    }
    fun writeEpisode(id: String,owner: String,number: Int,data: DraftRequest,saveVersion: Boolean) = repository.transaction {
        val w=own(id,owner); editable(id,number,data.revision)
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.body.length<=40000,message="제목은 120자, 원고는 40,000자 이내로 작성해 주세요.")
        val draft=Draft(data.title.trim(),data.body,data.revision+1)
        repository.writeDraft(id,number,draft)
        if(saveVersion) {
            val original=source(w)
            repository.saveWritingVersion(w,number,draft,if(w.world.mode=="following") original!!.worldId else w.worldId,
                selectSettings(effectiveHistory(w,original),number))
        }
        repository.writing(id,number)!!
    }
    fun restoreEpisode(id: String,owner: String,number: Int,data: RevertRequest) = repository.transaction {
        own(id,owner); val e=editable(id,number,data.revision)
        val v=e.versions.find { it.id==data.versionId } ?: throw ContentFailure(404,"이 회차의 저장 버전을 찾을 수 없어요.")
        writeEpisode(id,owner,number,DraftRequest(v.title,v.body,data.revision),true)
    }
    fun publishEpisode(id: String,owner: String,number: Int,data: PublishRequest) = repository.transaction {
        val w=own(id,owner); val e=editable(id,number,data.revision)
        val v=e.versions.find { it.id==data.versionId } ?: throw ContentFailure(409,"이 회차의 저장 버전을 먼저 선택해 주세요.")
        checkContent(data.rightsConfirmed && v.body.isNotBlank(),message="공개 권리와 저장된 원고를 확인해 주세요.")
        checkContent(number<=w.episodes.size+1,409,"앞 회차부터 순서대로 공개해 주세요.")
        if(w.source!=null && w.visibility!="public") checkContent(source(w)!!.allowForkPublication,403,"원작이 분기 작품의 최초 공개를 허용하지 않아요.")
        repository.publishWriting(w,number,v); repository.writing(id,number)!!
    }
    fun list(owner: String) = repository.transaction { repository.list(owner).map { view(it) } }
    fun read(id: String, owner: String) = repository.transaction { view(own(id,owner)) }
    fun publicList() = repository.transaction { repository.list().map { view(it,true) } }
    fun publicRead(id: String) = repository.transaction { val w=get(id); checkContent(w.visibility=="public",404,"공개 작품을 찾을 수 없어요."); view(w,true) }
    fun create(owner: String, data: CreateWorkRequest) = repository.transaction {
        val w=ContentWork(ownerId=owner,title=data.title.trim(),summary=data.summary.trim()); repository.save(w); view(w)
    }
    fun edit(id: String, owner: String, data: DraftRequest) = repository.transaction {
        val w=own(id,owner); revision(w,data.revision)
        w.draft=Draft(data.title.trim(),data.body,data.revision+1); checkpoint(w); repository.save(w); w.draft
    }
    fun history(id: String, owner: String) = repository.transaction { val w=own(id,owner); HistoryResponse(w.versions,w.proposals,w.policyHistory,w.publicationHistory) }
    fun policy(id: String, owner: String, data: PolicyRequest) = repository.transaction {
        val w=own(id,owner); revision(w,data.revision); checkContent(w.source==null,403,"분기 작품에서 재분기할 수 없어요.")
        w.allowFork=data.allowFork; w.allowForkPublication=data.allowForkPublication
        w.policyHistory.add(Policy(data.allowFork,data.allowForkPublication)); w.draft=w.draft.copy(revision=data.revision+1)
        repository.save(w); view(w)
    }
    fun publish(id: String, owner: String, data: PublishRequest) = repository.transaction {
        val w=own(id,owner); revision(w,data.revision)
        if(w.source!=null && w.visibility!="public") checkContent(source(w)!!.allowForkPublication,403,"원작이 분기 작품의 최초 공개를 허용하지 않아요.")
        val version=w.versions.find { it.id==data.versionId && it.episode==w.episodes.size+1 }
            ?: throw ContentFailure(409,"현재 작성 회차의 저장 버전을 명시적으로 선택해 주세요.")
        checkContent(data.rightsConfirmed && version.body.isNotBlank(),message="원고를 작성하고 공개 권리를 확인해 주세요.")
        w.episodes.add(Episode(w.episodes.size+1,version.revision,version.id,version.title,version.body))
        w.visibility="public"; w.allowFork=w.source==null && data.allowFork; w.allowForkPublication=w.source==null && data.allowForkPublication
        if(w.source==null && w.policyHistory.lastOrNull()?.let { it.allowFork==w.allowFork && it.allowForkPublication==w.allowForkPublication }!=true)
            w.policyHistory.add(Policy(w.allowFork,w.allowForkPublication))
        w.publicationHistory.add(Publication(w.episodes.size,version.id)); w.draft=(repository.writing(w.id,w.episodes.size+1)?.draft ?: Draft()).copy(revision=data.revision+1)
        repository.save(w); repository.recordPublicationRights(w.id,owner); view(w)
    }
    fun fork(id: String, owner: String, data: ForkRequest) = repository.transaction {
        val w=get(id)
        checkContent(w.source==null && w.visibility=="public" && w.allowFork,403,"이 작품은 분기를 허용하지 않아요.")
        checkContent(data.episode in 1..w.episodes.size,message="공개된 기준 회차를 선택해 주세요.")
        checkContent(repository.list(owner).none { it.source?.workId==id },409,"이미 만든 분기 작품이 있어요.")
        val episodes=w.episodes.take(data.episode).map { it.copy(inherited=true) }.toMutableList()
        val source=Source(id,w.title,data.episode,episodes.last().version,data.direction,w.policyHistory.lastIndex.takeIf { it>=0 },java.time.Instant.now().toString())
        val f=ContentWork(ownerId=owner,title=data.title.trim(),summary=data.summary,source=source,episodes=episodes,world=WorldState(mode="following"))
        f.world.basis=Basis(data.episode,source.version,inheritedSettings(f,w)); repository.save(f); view(f)
    }
    fun world(id: String, owner: String) = repository.transaction { val w=own(id,owner); worldView(w,source(w)) }
    fun saveSetting(id: String, sid: String, owner: String, data: SettingRequest) = repository.transaction {
        val w=own(id,owner); worldRevision(w,data.revision); validateSetting(data.setting)
        val original=source(w); val current=worldView(w,original)
        checkContent(data.sourceToken==current.sourceToken,409,"참조 원본 설정이 변경됐어요. 다시 불러와 주세요.")
        checkContent(sid=="new" || current.history.any { it.id==sid } || sid in w.world.drafts,404,"설정을 찾을 수 없어요.")
        detachWorld(w,original)
        val setting=data.setting.copy(id=if(sid=="new") contentId() else sid,versionId="")
        w.world.draft=setting; w.world.drafts[setting.id]=setting; w.world.revision++
        repository.save(w); worldView(w,original)
    }
    fun commitSetting(id: String, sid: String, owner: String, revision: Int) = repository.transaction {
        val w=own(id,owner); worldRevision(w,revision)
        appendSetting(w,w.world.drafts[sid] ?: throw ContentFailure(409,"설정 초안을 먼저 저장해 주세요."))
        repository.save(w); worldView(w,source(w))
    }
    fun revertSetting(id: String, sid: String, owner: String, data: RevertRequest) = repository.transaction {
        val w=own(id,owner); worldRevision(w,data.revision); val original=source(w)
        checkContent(w.world.drafts.isEmpty(),409,"작성 중인 설정 초안을 먼저 확정해 주세요.")
        val setting=effectiveHistory(w,original).find { it.id==sid && it.versionId==data.versionId && it.content.isNotEmpty() } ?: throw ContentFailure(404,"설정 버전을 찾을 수 없어요.")
        detachWorld(w,original); appendSetting(w,setting); repository.save(w); worldView(w,original)
    }
    fun change(id: String, owner: String, data: ChangeRequest) = repository.transaction {
        val w=own(id,owner); worldRevision(w,data.revision); val original=source(w)
        val change=worldChanges(w,original).find { it.id==data.changeId } ?: throw ContentFailure(409,"원본 변경이 달라졌어요. 알림을 다시 확인해 주세요.")
        checkContent(change.decision!="apply",409,"이미 반영한 변경이에요. 버전 복원을 이용해 주세요.")
        if(data.decision=="apply") {
            checkContent(w.world.drafts.isEmpty(),409,"설정 초안을 먼저 확정해 주세요.")
            appendSetting(w,change.after ?: change.before!!.copy(visibility="private",content="원본 공개 범위에서 제외됨"))
        } else w.world.revision++
        w.world.decisions[data.changeId]=data.decision; repository.save(w); worldView(w,original)
    }
    fun readContext(id: String, owner: String?, episode: Int, query: String, character: String) = repository.transaction {
        val w=if(owner==null) get(id) else own(id,owner)
        if(owner==null) checkContent(w.visibility=="public",404,"공개 작품을 찾을 수 없어요.")
        context(w,episode,query.take(2000),character.take(80),owner==null)
    }
    fun propose(id: String, owner: String, data: ProposalRequest): Proposal {
        checkContent(data.consent,message="OpenAI 전송과 API 비용에 동의해 주세요.")
        val jobId=contentId()
        val (selected,body)=repository.transaction {
            val w=own(id,owner); revision(w,data.revision)
            val selected=context(w,data.episode ?: w.episodes.size+1,data.prompt,data.character)
            repository.startJob(jobId,w,data.prompt)
            selected to w.draft.body
        }
        // Never hold a database transaction while waiting for a paid external call.
        try {
            val result=ai.generate(selected,data.prompt)
            repository.transaction { repository.completeCall(jobId,result.model,result.providerResponseId,result.usage) }
            return repository.transaction {
                val w=own(id,owner); revision(w,data.revision)
                checkContent(context(w,selected.basisEpisode,data.prompt,data.character)==selected,409,"생성 중 문맥이 변경됐어요. 원고에는 반영하지 않았어요.")
                val p=Proposal(id=jobId,text=result.text,model=result.model,revision=data.revision,prompt=data.prompt,baseBody=body,context=selected,providerResponseId=result.providerResponseId,usage=result.usage)
                w.proposals.add(p); repository.save(w); p
            }
        } catch(e: RuntimeException) {
            repository.transaction { repository.failJob(jobId,if(e is ContentFailure && e.status==409) "STALE_CONTEXT" else "GENERATION_OR_STORAGE_FAILED") }
            throw e
        }
    }
    fun accept(id: String, pid: String, owner: String, expected: Int) = repository.transaction {
        val w=own(id,owner); revision(w,expected)
        val p=w.proposals.find { it.id==pid && it.status=="pending" && it.revision==expected } ?: throw ContentFailure(409,"만료되었거나 이미 적용한 제안이에요.")
        checkContent(context(w,p.context.basisEpisode,p.prompt,p.context.character)==p.context,409,"설정 문맥이 변경됐어요. 최신 문맥으로 검토해 주세요.")
        val body=(w.draft.body+"\n\n"+p.text).trim(); checkContent(body.length<=40000,message="회차 원고는 40,000자까지 저장할 수 있어요.")
        w.draft=w.draft.copy(body=body,revision=expected+1); checkpoint(w); p.status="accepted"; repository.save(w); w.draft
    }
}

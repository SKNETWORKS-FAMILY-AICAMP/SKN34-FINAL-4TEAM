package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.publication.entity.*
import ai.storyfork.content.publication.repository.*
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.world.entity.*
import ai.storyfork.content.world.repository.*
import ai.storyfork.content.work.domain.*
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import java.time.Instant

@Service
@Transactional(transactionManager="contentTransactionManager")
class WorkService(
    private val access: WorkAccessService,
    private val members: ContentMemberService,
    private val works: WorkRepository,
    private val worlds: WorldRepository,
    private val workWorlds: WorkWorldHistoryRepository,
    private val visibility: WorkPublicationHistoryRepository,
    private val policies: ForkPolicyHistoryRepository,
    private val selectedPolicyEpisodes: ForkPolicyEpisodeRepository,
    private val genreRows: GenreRepository,
    private val workGenres: WorkGenreRepository,
    private val hashtagRows: WorkHashtagRepository,
    private val rightsRows: WorkRightsDeclarationRepository,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val versions: ai.storyfork.content.episode_version.service.EpisodeVersionService,
    private val proposals: ai.storyfork.content.proposal.service.ProposalService,
    private val viewService: WorkViewService,
    private val nicknames: CoreNicknameService,
    private val likeService: WorkLikeService,
    private val schedules: PublicationScheduleRepository,
) {

    fun list(owner: String): WorkListResponse {
        val rows=works.findAllByOwnerIdOrderByCreatedAtDesc(owner).filter {it.deletedAt==null}
        // 목록의 소유자는 모두 owner다. 잠금(원작 행 포함)을 쥔 채 Core를 기다리지 않도록 닉네임은 잠금 전에 한 번 조회한다. 작품이 없으면 부르지 않는다.
        val name=rows.firstOrNull()?.let {nicknames.nicknames(listOf(owner))[owner]} ?: WITHDRAWN_MEMBER_NAME
        access.lockScopes(rows.map {it.id})
        return WorkListResponse(rows.map {view(access.own(it.id,owner),false,name)})
    }
    /**
     * 공개 작품 목록이다. q·f·sort·page·size를 모두 생략하면 기존처럼 작품 생성 최신순 전체이며, 잘못된 f·sort·page·size는 422다.
     * 찾은 작품의 좋아요를 먼저 한 번에 세어 채운 뒤(like 정렬이 쓴다) 정렬하고, page·size가 오면 정렬을 마친 결과에서 그 구간만 돌려준다.
     */
    fun publicList(q: String?,f: String?,sort: String?,page: String? = null,size: String? = null): WorkListResponse {
        val field=queryOption(f,SearchField.ALL,"f");val order=queryOption(sort,WorkSort.LATEST,"sort");val window=workPage(page,size)
        val counts=viewService.counts()
        val found=withLikes(publicWorks(counts).filter {matchesSearch(it.title,it.authorName,it.genres,it.hashtags,q,field)})
        val newestFirst=found.map {it.id}
        val ordered=when(order) {
            WorkSort.LATEST->newestFirst
            WorkSort.LIKE->orderByLikes(newestFirst,found.associate {it.id to it.likes})
            WorkSort.VIEW->orderByViews(newestFirst,counts)
        }
        val byId=found.associateBy {it.id}
        return WorkListResponse(pageOf(ordered,window).map {byId.getValue(it)})
    }
    /**
     * 최근 24시간 조회 기준 실시간 인기(top)·급상승(rising) 공개 작품을 최대 10개 반환한다. 잘못된 kind는 422다.
     * 조회 기록이 있는 작품만 읽어 공개 여부로 거르고 순위(최대 10개)를 정한 뒤, 그 작품만 응답으로 조립한다.
     */
    fun ranking(kind: String): WorkListResponse {
        val rankingKind=queryOption(kind,RankingKind.TOP,"kind")
        val counts=viewService.counts()
        val visible=works.findAllById(counts.keys).sortedByDescending {it.createdAt}.map {access.get(it.id)}.filter {it.publiclyVisible()}
        val byId=visible.associateBy {it.id}
        val ranked=rankingIds(rankingKind,visible.map {it.id},counts).map {byId.getValue(it)}
        return WorkListResponse(withLikes(views(ranked,true).map {it.copy(views=counts.getValue(it.id).recent)}))
    }
    /**
     * 기간(period)·종류(kind)·범위(type)별 공개 작품 랭킹이다(기능표 45). 점수·제외·동점은 [periodRankingIds]가 정하고,
     * 공개 여부(`publiclyVisible`)와 type은 그 순위를 앞에서부터 훑으며 걸러 limit개를 모은다(상위 N개를 자른 뒤 거르지 않는다).
     * 잘못된 kind·period·type·limit은 어떤 조회보다 먼저 422다. 응답의 views는 그 period의 조회 수, likes는 전체 공개 좋아요 수다.
     * ponytail: 요청마다 조회·좋아요·발행 기록을 기간 안에서 다시 센다(캐시·배치 없음). 작품 수가 늘면 집계 테이블이나 캐시로 옮긴다.
     */
    fun rankings(kind: String,period: String?,type: String?,limit: String?): WorkRankingResponse {
        val rankKind=queryOption(kind,RankKind.VIEW,"kind");val rankPeriod=queryOption(period,RankPeriod.DAY,"period")
        val rankType=queryOption(type,RankType.ALL,"type");val size=rankLimit(limit)
        val now=Instant.now()
        val counts=viewService.counts(rankPeriod.length)
        val newLikes=if(rankKind==RankKind.POPULAR) likeService.countsSince(now.minus(rankPeriod.length)) else emptyMap()
        val updated=if(rankKind==RankKind.UPDATED) publication.lastPublished() else emptyMap()
        val ranked=periodRankingIds(rankKind,works.findAll().sortedByDescending {it.createdAt}.map {it.id},counts,newLikes,updated)
        val shown=ranked.asSequence().map {access.get(it)}.filter {it.publiclyVisible() && matchesType(rankType,it.source!=null)}.take(size).toList()
        val items=views(shown,true).map {it.copy(views=counts[it.id]?.recent ?: 0,updatedAt=updated[it.id])}
        return WorkRankingResponse(withLikes(items),now,rankKind.name.lowercase(),rankPeriod.name.lowercase(),rankType.name.lowercase())
    }
    private fun publicWorks(counts: Map<String,WorkViews>): List<WorkResponse> =
        views(works.findAll().sortedByDescending {it.createdAt}.map {access.get(it.id)}.filter {it.publiclyVisible()},true)
            .map {it.copy(views=counts[it.id]?.recent ?: 0)}
    fun read(id: String,owner: String): WorkResponse = views(listOf(access.own(id,owner))).single()
    /** 공개 상세다. [member]가 있으면(Bearer가 온 요청) 그 회원의 좋아요 여부(liked)를 채우고 익명은 false다. */
    fun publicRead(id: String,member: String? = null): WorkResponse =
        views(listOf(access.published(id)),true).single().copy(likes=likeService.counts(listOf(id))[id] ?: 0,liked=member!=null && likeService.liked(id,member),episodeViews=viewService.episodeCounts(id))
    /** 공개 작품의 발행 회차(본문 포함)다. 작가명이 필요 없는 내부 호출(표지·이미지 공개 열람)이 Core 조회 없이 공개 여부와 본문을 확인한다. 비공개·제한 작품은 404다. */
    fun publicEpisodes(id: String): List<PublishedEpisodeResponse> {
        val w=access.published(id)
        return w.readerEpisodes(publication.publishedEpisodes(id).items)
    }
    fun create(owner: String,data: CreateWorkRequest): WorkResponse {
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000,message="작품 제목과 소개를 확인해 주세요.")
        val registered=data.creationType!=null || data.genres.isNotEmpty() || data.hashtags.isNotEmpty() || data.rightsConfirmed!=null
        val meta=if(registered) validateWorkMetadata(data.creationType,data.genres,data.hashtags,data.rightsConfirmed==true) else null
        val genreIds=meta?.let {
            val found=genreRows.findAllByNameIn(it.genres)
            checkContent(found.size==it.genres.size,message="승인된 장르 목록에서 서로 다른 장르를 골라 주세요.")
            found
        }.orEmpty()
        members.ensure(owner)
        val id=contentId()
        worlds.saveAndFlush(WorldEntity(id=id,ownerId=owner,name=data.title.trim()+" 설정집"))
        works.saveAndFlush(WorkEntity(id=id,ownerId=owner,title=data.title.trim(),description=data.summary.trim(),originKind="original",revision=0,creationType=meta?.type?.code ?: "original"))
        workWorlds.saveAndFlush(WorkWorldHistoryEntity(id=contentKey("work-world",id,"0"),workId=id,worldId=id,revisionNo=0))
        visibility.saveAndFlush(WorkPublicationHistoryEntity(id=contentKey("work-publication",id,"0"),workId=id,revisionNo=0,visibility="private"))
        if(meta!=null) {
            workGenres.saveAll(genreIds.map {WorkGenreEntity(workId=id,genreId=it.id)})
            hashtagRows.saveAll(meta.hashtags.mapIndexed {i,tag->WorkHashtagEntity(id=contentKey("work-hashtag",id,i.toString()),workId=id,tag=tag,position=i)})
            rightsRows.save(WorkRightsDeclarationEntity(id=contentId(),workId=id,memberId=owner,noticeVersion="registration-rights-v1",response="confirmed"))
        }
        val episode=episodes.saveAndFlush(EpisodeEntity(id=episodeId(id,1),workId=id,sequence=1))
        drafts.saveAndFlush(EpisodeDraftEntity(episodeId=episode.id,title="새 회차",content="",editRevision=0))
        return read(id,owner)
    }
    fun update(id: String,owner: String,data: UpdateWorkRequest): WorkResponse {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.summary.length<=2000,message="작품 제목과 소개를 확인해 주세요.")
        val row=works.findById(id).orElseThrow()
        row.title=data.title.trim();row.description=data.summary.trim();row.revision++
        works.saveAndFlush(row)
        return read(id,owner)
    }
    /**
     * 작품을 소프트 삭제한다(DEC-42). 행은 지우지 않고 삭제 시각만 기록하며, 이후 목록·검색·랭킹·읽기·분기 생성에서 제외된다.
     * 이 작품을 원작으로 둔 Fork는 원작 행을 그대로 참조하고 "삭제된 원작"으로 표시된다. 분기 작품과 세계관 설정이 있는 작품도 삭제할 수 있다.
     */
    fun delete(id: String,owner: String) {
        access.own(id,owner)
        val row=works.findById(id).orElseThrow()
        row.deletedAt=java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        works.saveAndFlush(row)
    }
    fun stopForkPublication(id: String,owner: String) {
        val work=access.own(id,owner)
        checkContent(work.source!=null,404,"포크 작품을 찾을 수 없어요.")
        val last=visibility.findFirstByWorkIdOrderByRevisionNoDesc(id) ?: return
        if(last.visibility!="public") return
        visibility.save(WorkPublicationHistoryEntity(id=contentId(),workId=id,revisionNo=last.revisionNo+1,visibility="private"))
        // 대기 중인 예약 발행이 실행 시점에 중단한 Fork를 다시 공개하지 못하게 함께 취소한다. 작품 잠금 안이라 예약 실행과 겹치지 않는다.
        val now=Instant.now()
        schedules.findAllByWorkIdAndStatus(id,"pending").forEach {it.cancel(it.revision,now)}
        works.findById(id).orElseThrow().revision++
    }

    fun policy(id: String,owner: String,data: PolicyRequest): WorkResponse {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        checkContent(w.source==null,403,"분기 작품에서 재분기할 수 없어요.")
        val last=policies.findFirstByWorkIdOrderByRevisionNoDesc(id)
        val scope=data.episodeScope ?: last?.episodeScope ?: "all"
        checkContent(scope in setOf("all","from","selected"),message="분기 허용 범위를 확인해 주세요.")
        checkContent((data.fromEpisode==null || data.episodeScope=="from") && (data.episodes.isEmpty() || data.episodeScope=="selected"),message="분기 허용 범위와 회차를 함께 확인해 주세요.")
        val published=if(data.episodeScope!=null && scope!="all") publication.publishedEpisodes(id).items.map {it.number} else emptyList()
        if(data.episodeScope=="from") checkContent(data.fromEpisode in published,message="공개된 시작 회차를 선택해 주세요.")
        if(data.episodeScope=="selected") checkContent(data.episodes.isNotEmpty() && data.episodes.distinct().size==data.episodes.size && data.episodes.all {it in published},message="공개된 허용 회차를 선택해 주세요.")
        val revision=(last?.revisionNo ?: -1)+1
        val policyId=contentKey("policy",id,revision.toString())
        val start=if(scope=="from") {
            if(data.episodeScope==null) last?.startEpisodeId
            else episodes.findByWorkIdAndSequence(id,data.fromEpisode!!)?.id
                ?: throw ContentFailure(409,"선택한 시작 회차를 다시 확인해 주세요.")
        } else null
        val selected=if(scope!="selected") emptyList() else if(data.episodeScope==null) {
            last?.let {selectedPolicyEpisodes.findAllByPolicyHistoryId(it.id).map {row->row.episodeId}}.orEmpty()
        } else episodes.findAllByWorkIdOrderBySequence(id).filter {it.sequence in data.episodes}.map {it.id}
        policies.saveAndFlush(ForkPolicyHistoryEntity(id=policyId,workId=id,revisionNo=revision,allowCreation=data.allowFork,allowPublication=data.allowForkPublication,episodeScope=scope,startEpisodeId=start))
        if(scope=="selected") selectedPolicyEpisodes.saveAll(selected.map {ForkPolicyEpisodeEntity(policyId,it,id)})
        works.findById(id).orElseThrow().revision++
        return read(id,owner)
    }
    fun history(id: String,owner: String): HistoryResponse {
        access.own(id,owner)
        return HistoryResponse(versions.history(id).items,proposals.history(id,owner).items,
            policies.findAllByWorkIdOrderByRevisionNo(id).map {PolicyResponse(it.allowCreation,it.allowPublication,it.changedAt.toString())},publication.history(id).items)
    }
    /** 공개 목록 응답에 좋아요 수를 채운다. 작품 id 묶음으로 한 번에 세어 작품마다 조회하지 않는다. */
    private fun withLikes(items: List<WorkResponse>): List<WorkResponse> {
        val counts=likeService.counts(items.map {it.id})
        return items.map {it.copy(likes=counts[it.id] ?: 0)}
    }
    /**
     * 작가명은 소유자의 Core 최신 닉네임이다. 소유자 ID를 모아 한 번만 조회하고, Core에 없는 소유자는 탈퇴한 회원으로 보인다.
     * ponytail: 트랜잭션 안에서 Core를 부른다(시연 규모). 목록(list)은 잠금 전에 부르지만 단건 경로(read·생성·수정·정책·분기)는 잠금을 쥔 채 Core를 1회 부른다(최대 약 4초: 연결 1s + 읽기 3s).
     * Core 지연이 커지면 단건 경로도 잠금 전에 부르거나 조회를 마친 뒤 트랜잭션 밖에서 채운다.
     */
    private fun views(ws: List<WorkAccessResult>,public: Boolean = false): List<WorkResponse> {
        val names=nicknames.nicknames(ws.map {it.ownerId})
        return ws.map {view(it,public,names[it.ownerId] ?: WITHDRAWN_MEMBER_NAME)}
    }
    private fun view(w: WorkAccessResult,public: Boolean,authorName: String): WorkResponse {
        val all=publication.publishedEpisodes(w.id).items
        val published=if(public) w.readerEpisodes(all) else all
        val next=if(public) null else publication.nextEpisodeNumber(w.id)
        val draft=if(public) null else {
            val e=episodes.findByWorkIdAndSequence(w.id,next!!)
            val d=e?.let {drafts.findById(it.id).orElse(null)}
            DraftResponse(d?.title ?: "새 회차",d?.content ?: "",w.revision,d?.authorNote.orEmpty())
        }
        val row=works.findById(w.id).orElseThrow()
        val genres=genreRows.findAllById(workGenres.findAllByWorkId(w.id).map {it.genreId}).map {it.name}.sortedBy {WORK_GENRES.indexOf(it)}
        val tags=hashtagRows.findAllByWorkIdOrderByPosition(w.id).map {it.tag}
        val type=CreationType.entries.first {it.code==row.creationType}.name
        return WorkResponse(w.id,w.title,w.summary,w.visibility,w.allowFork,w.allowForkPublication,w.source,published,draft,
            hasWritingEpisode=!public && episodes.countWritingAt(w.id,next!!)>0,writingEpisodeNumber=next,creationType=type,genres=genres,hashtags=tags,
            slug=row.slug,authorName=authorName,ownerId=w.ownerId,revision=w.revision,theme=row.theme,hook=row.hook,hanja=row.hanja,
            hero=row.heroLine1?.let {listOf(it,row.heroLine2.orEmpty())},heroBg=row.heroBackground,
            forkableEpisodes=if(w.source==null) access.forkable(w.id,published.map {it.number}) else emptyList())
    }

}

import { COMMENT_SORTS, type EpisodeComment } from '../../../../domain/entities/episodeComment'
import { avatarOf } from '../../../../domain/entities/work'
import { kstDateTime } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { useWorkCommentsViewModel } from '../viewmodel/useWorkCommentsViewModel'

/** 읽기 전용 댓글 한 줄. 작성·수정·삭제·좋아요는 회차 화면에서 하고 여기서는 좋아요 수와 그 회차로 가는 링크만 보입니다. */
function WorkCommentRow({ c, workId, best }: { c: EpisodeComment; workId: string; best: boolean }) {
  const body = <div className={c.hidden ? 'cbody muted' : 'cbody'}>{c.hidden ? '운영 정책으로 숨겨진 댓글입니다.' : c.body}</div>
  return (
    <div className="cm">
      <i className="av" style={{ background: avatarOf(c.authorName) }} />
      <div>
        <b>{best && <span className="wc-badge">BEST</span>}{c.authorName}<small> · {kstDateTime(c.createdAt)}</small></b>
        {c.spoiler && !c.hidden ? <details><summary>스포일러 댓글 보기</summary>{body}</details> : body}
        <div className="cact"><Go to={`/read/${workId}/${c.episodeNumber}`} className="lk">{c.episodeNumber}화</Go></div>
      </div>
      {!c.hidden && <span className="lk"><span aria-hidden="true">♥</span> {c.likeCount}<span className="sr-only"> 좋아요</span></span>}
    </div>
  )
}

/**
 * 소설 상세 아래의 작품 전체 댓글(읽기 전용): BEST 3개, 정렬 전환, 전체 목록. 로딩·실패(재시도)·빈 상태는 실제 응답 그대로다.
 * start는 댓글이 없을 때 첫 댓글을 남기러 갈 회차(읽기 시작 회차)이고, 읽을 수 있는 회차가 없으면 비운다.
 */
export function WorkComments({ workId, canonical, start }: { workId: string; canonical: boolean; start?: number }) {
  const vm = useWorkCommentsViewModel(workId, canonical)
  const { comments, best } = vm
  return (
    <section className="tcard cms wcomments" aria-labelledby="wc-title">
      <h2 id="wc-title">{comments ? `전체 댓글 ${comments.length}` : '전체 댓글'}</h2>
      {!canonical ? <p className="muted">데모에서는 지원하지 않아요. 서버 작품에서만 전체 댓글을 볼 수 있어요.</p> : (
        <>
          {vm.isError && (
            <div role="alert">
              <p className="muted">댓글을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
              <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
            </div>
          )}
          {!comments && !vm.isError && <p className="muted" role="status">댓글을 불러오고 있어요…</p>}
          {/* 문장 안 링크는 클래스 없이 둔다: 전역의 문단 속 링크 규칙(밑줄·링크색)이 본문 글자와 구분해 준다. */}
          {comments?.length === 0 && <p className="muted">아직 댓글이 없어요. {start ? <><Go to={`/read/${workId}/${start}`}>{start}화</Go>를 읽고</> : '회차 화면에서'} 첫 댓글을 남겨 보세요.</p>}
          {best.length > 0 && <div className="wc-best" role="group" aria-label="베스트 댓글">{best.map((c) => <WorkCommentRow key={c.id} c={c} workId={workId} best />)}</div>}
          {!!comments?.length && (
            <>
              <div className="sortt" role="group" aria-label="댓글 정렬">
                {COMMENT_SORTS.map(([k, label]) => <button key={k} type="button" className={vm.sort === k ? 'on' : ''} aria-pressed={vm.sort === k} onClick={() => vm.setSort(k)}>{label}</button>)}
              </div>
              {comments.map((c) => <WorkCommentRow key={c.id} c={c} workId={workId} best={best.some((b) => b.id === c.id)} />)}
            </>
          )}
        </>
      )}
    </section>
  )
}

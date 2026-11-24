import { useId, useMemo, useState, type ReactNode } from 'react'

import { worldCoverError, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import { AiCoverButton } from '../../../shared/AiCoverButton'
import { coverSrc } from '../../../shared/cover'
import { useLinkedWork } from '../viewmodel/useWorldNovelLink'
import type { useWorldRevisions } from '../viewmodel/useWorldRevisions'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { PublicCardsNotice, PublishFields } from './WorldPublishFields'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 관리 모드 '개요' 탭(주소 `?view=overview`)의 세계관 정보 편집 폼(/content 작품 정보 편집과 같은 ep-edit 틀). 이름·설명·공개 범위·장르·표지를 한 곳에서 고치고 저장·되돌린다.
 * 탭 본문이라 열어도 입력으로 초점을 옮기지 않고(메뉴에서 탭을 옮기다 입력칸으로 끌려가지 않게) Esc로 닫히지도 않는다. 저장해도 탭은 그대로이고 `저장했어요.`를 알린다(고치면 사라진다).
 * 표지 묶음 맨 앞에 지금 표지(올린 표지 또는 기본 표지)와 고른 파일이 보이고, 세계관 삭제는 폼 맨 아래 삭제 구획(`.ep-delete`)에 있다.
 * 폼은 구획 카드(기본 정보·공개 설정·표지·세계관 삭제, `.world-info-card`)로 나뉘어 보이지만 폼·바깥 fieldset·저장 버튼은 하나이고 카드는 그 안의 묶음일 뿐이라 저장 계약은 그대로다(world-studio.css).
 * 저장은 바뀐 것만 이 순서로 보낸다: 이름·설명은 기존 초안 저장, 공개 범위·장르는 기존 공개 설정(`vm.setPublication`, 공개로 바꿀 때만 한 번 확인), 표지는 고른 이미지 올리기(교체 포함)다.
 * 하나라도 실패하면 오류를 알리며 입력을 그대로 둬 남은 것만 다시 저장할 수 있다. `되돌리기`는 바뀐 입력과 고른 표지를 저장값으로 되돌리고(한글 조합을 끝내려고 누른 Esc 같은 닫기는 없다) 바뀐 것이 없으면 잠겨 있다.
 * 표지 삭제만은 확인한 뒤 바로 지운다. 표지 'AI로 생성'은 연결 전이라 비활성이다.
 * 저장하지 않은 수정이 있으면(`vm.infoLocked`) 그 수정이 이름·설명 저장에 딸려 가지 않도록, 이름·설명을 바꾼 동안에는 저장을 잠그고 먼저 저장하라고 알린다.
 * 공개 범위·장르·표지는 초안 저장과 별개라 잠그지 않는다: 공개로 고른 뒤 경고의 `전체 공개`(초안 변경)를 눌러도 공개 설정은 그대로 저장할 수 있다.
 * 서버에서 다시 읽으면(`vm.relationKey`) 호출 쪽이 이 폼을 새로 만들어 낡은 입력이 남지 않게 한다.
 */
export function WorldInfoPanel({ vm, world }: { vm: VM; world: StudioWorld }) {
  const [name, setName] = useState(world.name)
  const [description, setDescription] = useState(world.description)
  const [publication, setPublication] = useState(vm.publication)
  const [cover, setCover] = useState<File>()
  // 파일 입력은 같은 파일을 다시 고르면 change가 없으므로 저장·되돌린 뒤에는 새로 만든다.
  const [coverInput, setCoverInput] = useState(0)
  const [coverProblem, setCoverProblem] = useState('')
  const [done, setDone] = useState(false)
  const lockId = useId()
  const deleteId = useId()
  const basicId = useId()
  const infoChanged = name.trim() !== world.name || description !== world.description
  const publicationChanged = publication.visibility !== vm.publication.visibility || publication.genre !== vm.publication.genre
  const changed = infoChanged || publicationChanged || !!cover
  const locked = infoChanged && vm.infoLocked
  const canSave = changed && !!name.trim() && !locked
  const clearCover = () => {
    setCover(undefined)
    setCoverProblem('')
    setCoverInput((n) => n + 1)
  }
  const save = async () => {
    if (!canSave) return
    setDone(false)
    if (infoChanged && !(await vm.saveInfo(name.trim(), description))) return
    if (publicationChanged && !(await vm.setPublication(publication))) return
    if (cover && !(await vm.setCover(cover))) return
    clearCover()
    setDone(true)
  }
  const reset = () => {
    setName(world.name)
    setDescription(world.description)
    setPublication(vm.publication)
    clearCover()
    setDone(false)
  }
  // 형식·크기가 맞지 않는 파일은 고르는 순간 이유를 알리고 받지 않는다.
  const pickCover = (file: File | undefined) => {
    if (!file) return
    const problem = worldCoverError(file)
    setCoverProblem(problem ?? '')
    setCover(problem ? undefined : file)
  }
  // 세계관 삭제: 서버는 소프트 삭제라 목록·공개에서만 사라진다. 연결된 소설이 있으면 서버도 거절하지만 버튼부터 이유와 함께 잠근다.
  const remove = () => {
    if (window.confirm(`'${world.name}' 세계관을 삭제할까요?\n내 세계관 목록에서 사라져요. 공개한 세계관이면 공개 화면에서도 사라져요.`)) void vm.deleteWorld()
  }
  return (
    <>
      <form
        className="ep-edit world-info-edit"
        aria-label="세계관 정보 편집"
        onSubmit={(e) => { e.preventDefault(); void save() }}
      >
        <fieldset disabled={vm.busy}>
          <div className="world-info-card world-info-basic" role="group" aria-labelledby={basicId}>
            <h3 id={basicId}>기본 정보</h3>
            <label>세계관 이름<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required /></label>
            <label>세계관 설명<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} rows={4} /></label>
          </div>
          <div className="world-info-card">
            <fieldset className="world-publish world-compact">
              <legend>공개 설정</legend>
              <PublishFields value={publication} onChange={(change) => setPublication((current) => ({ ...current, ...change }))} />
              <p className="small muted">저장하면 적용돼요. 공개 화면에는 확정 버전의 공개 설정만, 소설이 발행한 회차까지 보여요.</p>
              <PublicCardsNotice vm={vm} visibility={publication.visibility} />
            </fieldset>
          </div>
          <div className="world-info-card world-cover-edit" role="group" aria-label="표지">
            <span className="world-cover-label">표지</span>
            <div className="world-cover-now cov"><img src={coverSrc(vm.cover.url)} alt={vm.cover.url ? '현재 표지' : '기본 표지'} /></div>
            <div className="ep-cover-pick">
              <label className="btn sm ep-file-pick">
                이미지 선택
                <input key={coverInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={!vm.supportsCover} onChange={(e) => pickCover(e.target.files?.[0])} />
              </label>
              <AiCoverButton />
              {vm.supportsCover && world.hasCover && (
                <button type="button" className="btn sm" onClick={() => { if (window.confirm('표지를 삭제할까요? 기본 표지로 돌아가요.')) void vm.setCover(null) }}>표지 삭제</button>
              )}
            </div>
            {cover
              ? <div className="ep-file-chosen"><span>{`선택한 파일: ${cover.name}`}</span></div>
              : <p className="small muted">{vm.supportsCover ? 'PNG·JPEG·WebP, 5 MiB 이하.' : '데모에서는 표지 업로드를 지원하지 않아요.'}</p>}
            {coverProblem && <p role="alert" className="small">{coverProblem}</p>}
            {vm.coverAction && <p role="status" className="small muted">{vm.coverAction === 'upload' ? '표지를 올리고 있어요…' : '표지를 지우고 있어요…'}</p>}
            {vm.cover.error && <p className="small muted">{vm.cover.error}</p>}
          </div>
          {locked && <p id={lockId} role="status" className="small muted">작성 중인 변경을 먼저 저장하세요.</p>}
          <div className="ep-edit-actions">
            <button className="btn pri sm" disabled={!canSave} aria-describedby={locked ? lockId : undefined}>{vm.saveState === 'saving' ? '저장 중…' : '저장'}</button>
            <button type="button" className="btn sm" disabled={!changed} onClick={reset}>되돌리기</button>
          </div>
          <p role="status" className="small muted">{done && !changed ? '저장했어요.' : ''}</p>
          {vm.supportsDelete && (
            <div className="ep-delete world-info-card" role="group" aria-label="세계관 삭제">
              <button type="button" className="btn sm ep-danger" disabled={!!vm.linkedWorkId} aria-describedby={deleteId} onClick={remove}>세계관 삭제</button>
              <p id={deleteId} className="small muted">{vm.linkedWorkId ? '연결된 소설이 있어 삭제할 수 없어요. 작품 관리에서 연결을 해제한 뒤 삭제하세요.' : '삭제하면 내 세계관 목록과 공개 화면에서 사라져요.'}</p>
            </div>
          )}
        </fieldset>
      </form>
    </>
  )
}

const number = (value: number) => value.toLocaleString('ko-KR')
/** 읽는 중: 모르는 값을 0으로 채우지 않고 자리만 잡는다(작품 관리 개요의 지표와 같은 규칙). */
const LOADING = <>…<span className="sr-only">불러오는 중</span></>
const FAILED = '불러오지 못했어요'

/** 지표 한 칸(작품 관리 개요 `WorkDashboard`의 칸과 같은 `.ep-metrics` 안의 모양). 글자(없음·불러오지 못했어요·긴 상태)는 숫자 칸보다 작은 보조 글이고, `text`는 값인 글(소설 제목)이라 본문색이다. */
function Metric({ label, note, text, children }: { label: string; note?: boolean; text?: boolean; children: ReactNode }) {
  return <div><dt>{label}</dt><dd className={note ? 'ep-muted' : text ? 'world-metric-title' : undefined}>{children}</dd></div>
}

/** 확정 버전 칸: 현재 확정 버전이 없으면 읽을 것 없이 0개다. 있으면 목록(`useWorldRevisions`)을 센다 — 읽는 동안은 …, 목록을 읽지 못했으면 불러오지 못했어요(목록이 빈 채 알림이 있는 경우뿐이라 확정 요청 같은 다른 동작의 실패 알림과 헷갈리지 않는다). 서버가 목록을 주지 않는 데모에는 칸이 없다. */
function RevisionMetric({ world, revisions }: { world: StudioWorld; revisions: ReturnType<typeof useWorldRevisions> }) {
  if (!revisions.supported) return null
  if (!world.currentRevisionId) return <Metric label="확정 버전">0개</Metric>
  if (revisions.rows.length) return <Metric label="확정 버전">{number(revisions.rows.length)}개</Metric>
  return revisions.error ? <Metric label="확정 버전" note>{FAILED}</Metric> : <Metric label="확정 버전">{LOADING}</Metric>
}

/** 연결 소설 칸: 연결이 없으면 없음, 있으면 내 소설 목록에서 찾은 제목(`useLinkedWork`, '소설 연결' 탭·마법사 헤더와 같은 규칙)이다. 읽는 동안은 …, 못 찾으면 제목을 불러오지 못했어요. */
function NovelMetric({ linkedWorkId }: { linkedWorkId: string | null }) {
  const { title, isLoading } = useLinkedWork(linkedWorkId)
  if (!linkedWorkId) return <Metric label="연결 소설" note>없음</Metric>
  if (title) return <Metric label="연결 소설" text>{title}</Metric>
  return isLoading ? <Metric label="연결 소설">{LOADING}</Metric> : <Metric label="연결 소설" note>제목을 불러오지 못했어요</Metric>
}

/**
 * 개요 탭 맨 위 세계관 지표(작품 관리 개요 `WorkDashboard`의 지표 띠와 같은 `.ep-dash`·`.ep-metrics`, shared/episode.css). 저장한 세계관(`world`) 기준이고 새 API 없이 이 화면이 이미 가진 값만 쓴다:
 * 설정 카드(헤더 칩과 같은 계산)·관계·저장 버전·확정 버전(`revisions`)·연결 소설(`useLinkedWork`, 서버가 없는 데모에는 연결이 없어 칸을 두지 않는다)·공개 상태(공개 목록에 나오는지까지: 확정 버전이 없는 공개 세계관은 `목록 미노출`).
 * 모르는 값은 0으로 채우지 않는다(읽는 동안 …, 읽지 못하면 그렇다고 알린다).
 */
export function WorldOverviewMetrics({ vm, world, revisions }: { vm: VM; world: StudioWorld; revisions: ReturnType<typeof useWorldRevisions> }) {
  const titleId = useId()
  // 개요 탭은 한 번 열면 다른 보기에서도 숨긴 채 남아 입력마다 다시 그려지므로, 카드가 수천 장인 세계관에서 매번 세지 않게 저장본이 바뀔 때만 센다.
  const counts = useMemo(() => ({ cards: cardLibraryRows(world.settings, 'all', '').length, relations: world.settings.filter((s) => s.item.kind === 'relation').length }), [world.settings])
  const status = vm.publication.visibility !== 'public' ? '비공개' : vm.listing === 'listed' ? '공개 중' : vm.listing === 'unlisted' ? '공개 · 목록 미노출' : '공개'
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId}>세계관 지표</h3>
      <dl className="ep-metrics">
        <Metric label="설정 카드">{number(counts.cards)}개</Metric>
        <Metric label="관계">{number(counts.relations)}개</Metric>
        <Metric label="저장 버전">{number(world.version)}개</Metric>
        <RevisionMetric world={world} revisions={revisions} />
        {import.meta.env.MODE !== 'mockup' && <NovelMetric linkedWorkId={vm.linkedWorkId} />}
        <Metric label="공개 상태" note={vm.listing === 'unlisted'}>{status}</Metric>
      </dl>
    </section>
  )
}

import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { inheritedCardGroups, type Work } from '../../../../domain/entities/content'
import { filterByName } from '../../../../domain/entities/nameSearch'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { coverSrc } from '../../../shared/cover'
import { Go } from '../../../shared/Go'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useWorldCoverImage } from '../../../shared/useWorldCoverImage'
import { useInheritedWorld } from '../viewmodel/useInheritedWorld'
import { useWorldReleaseCheck } from '../viewmodel/useWorldReleaseCheck'
import type { WorldRelease } from '../viewmodel/unlinkWorld'
import { WorldReleaseWarning } from './WorldReleaseWarning'

type Props = {
  work: Pick<Work, 'id' | 'worldStudioId' | 'source'>
  /** 작품 관리 화면이 다른 요청을 처리하는 중이면 연결·해제를 잠근다. */
  busy: boolean
  /** 연결(세계관 id)·해제(null)를 서버에 보낸다. 결과 안내와 실패 사유는 호출한 쪽이 error·notice로 넘겨 이 카드 안에 보인다. 공개 세계관의 해제는 경고 대화 상자가 확인을 받은 뒤 [release]를 함께 넘긴다(결정 4). */
  onLink: (worldId: string | null, release?: WorldRelease) => Promise<boolean>
  /** 이어받는 원작 세계관을 내 세계관으로 독립시킨다. 새 세계관 id를 돌려주면(취소·실패는 null) 그 관리 화면으로 간다. 실패 사유는 호출한 쪽이 detachError로 넘겨 이어받는 세계관 카드 안에 보인다. */
  onDetach: () => Promise<string | null>
  /** 이 카드에서 보낸 연결·해제의 실패 사유와 완료 안내(다른 요청의 것은 넘기지 않는다) */
  error?: string
  notice?: string
  /** 이 화면에서 보낸 독립 요청의 실패 사유(이어받는 세계관 카드 안에 보인다) */
  detachError?: string
  /** 테스트가 넣는 이어받는 세계관 조회 대역 */
  useCase?: Pick<EpisodeUseCase, 'inheritedWorld'>
  /** 테스트가 넣는 내 세계관 조회·표지 읽기 대역 */
  worlds?: Pick<WorldStudioUseCase, 'list' | 'cover' | 'supportsCover'>
}

/**
 * 세계관·설정집 탭의 세계관 연결(DEC-46): 소설과 내 세계관(WorldStudio)은 1:1로 연결한다.
 * 연결된 세계관이 공개 상태이면 `연결 해제`가 경고 대화 상자(`role="alertdialog"`)를 연다(결정 4): 해제하면 작가 전용이던 카드까지 모든 설정이 독자에게 공개되므로 `세계관을 비공개로 바꾸고 해제`(처음 초점)·`공개 그대로 해제`·`취소`를 고르게 한다.
 * 비공개를 고르면 세계관 공개 설정(장르는 현재 값 그대로)을 먼저 보내고 성공했을 때만 해제한다. 실패하면 해제하지 않고 서버 문구를 이 카드 안에 알린다. 세계관이 비공개면 경고 없이 지금처럼 해제한다(기존 확인).
 * 공개 여부는 `연결 해제`를 누른 그때 내 세계관 목록을 한 번 다시 읽어 최신 값으로 정한다(탭을 연 뒤 다른 곳에서 바뀌었을 수 있다, 읽는 동안 버튼이 잠기고 화면을 떠나면 다시 읽기를 취소한다). 다시 읽지 못했거나 목록에 이 세계관이 없어 모르면
 * 공개일 수 있다는 경고가 비공개 선택지 없이 `공개 그대로 해제`·`취소`만 보인다(장르를 몰라 비공개로 바꿀 수 없다, 처음 초점은 `취소`). 처음 목록을 읽는 동안에도 버튼은 잠긴다(`isLoading`).
 * 해제가 성공하면 초점이 있던 버튼이 사라지므로 연결 구역의 제목(`세계관 연결`)으로 초점을 옮긴다. 실패하면 버튼이 남아 경고 상자를 닫을 때 그리로 돌아온다.
 * 연결돼 있으면 그 세계관 관리 화면으로 가는 이름과 `연결 해제`를, 아니면 다른 소설에 연결되지 않은 내 세계관을 골라 `세계관 연결`을 보인다. 1:1·독자 위키 공개 범위 설명은 고를 때 필요한 정보라 연결 전에만 보인다.
 * 세계관은 검색 화면(`/search`)과 같은 둥근 `세계관 검색` 입력이 이름(대소문자·앞뒤 공백 무시, 비면 전체)으로 거른 표지 카드 목록에서 고르고(카드 한 장이 라디오 하나), 결과가 없으면 `검색 결과가 없어요`를 알린다. 검색창은 연결 양식 밖이라 Enter로 연결하지 않는다. 아무것도 고르지 않은 채 시작해 고르기 전에는 버튼이 잠기고 이유를 알린다(UC-24 E1: 세계관을 고르지 않으면 연결하지 않는다).
 * 고른 세계관이 검색으로 목록에서 빠지면 선택을 비운다(보이지 않는 세계관으로 연결하지 않는다). 해제하면 고른 값과 검색어도 비워, 다시 나타난 양식이 직전에 연결했던 세계관·검색어로 시작하지 않는다.
 * 내 세계관 목록은 탭을 열 때 공용 `useAsyncData`로 읽고 불러오는 중·실패(다시 불러오기)·고를 세계관 없음을 따로 알린다. 다시 읽기가 실패해도 앞서 읽은 목록은 남기고 실패를 함께 알린다.
 * 자기 세계관이 없는 Fork는 이 카드 위에 `이어받는 원작 세계관` 카드를 따로 둔다(#583, DEC-37): 원작 세계관을 읽기 전용으로 보이고 `내 세계관으로 만들어 수정하기`로 독립한다. 성공하면 새 세계관 관리 화면으로 간다.
 * ponytail: 후보를 모두 카드로 그리고 올린 표지를 카드마다 한 번씩 읽으며 CSS 최대 높이로 스크롤한다. 수백 개가 되면 서버 검색·쪽 나누기가 필요하다.
 * ponytail: 연결·해제 뒤 목록을 다시 읽지 않는다(공개 여부는 해제 직전에 따로 다시 읽는다). 그 사이 다른 곳에서 연결이 바뀌었으면 서버가 409로 거절하고 그 사유가 이 카드 안에 보인다.
 */
export function LinkedWorldPanel({ work, busy, onLink, onDetach, error, notice, detachError, useCase, worlds = appContainer.resolve('worldStudioUseCase') }: Props) {
  const navigate = useNavigate()
  const { data: mine, isLoading, isError, retry } = useAsyncData((signal) => worlds.list(signal), [worlds])
  const [picked, setPicked] = useState('')
  const [query, setQuery] = useState('')
  const title = useRef<HTMLHeadingElement>(null)
  const hint = useId()
  const group = useId()
  const linked = work.worldStudioId
  const { warning, checking, check, close } = useWorldReleaseCheck(linked, worlds)
  const linkedWorld = mine?.find((w) => w.id === linked)
  // 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 목록에 아직 이 소설로 적혀 있으므로 함께 고를 수 있게 둔다.
  const options = mine?.filter((w) => !w.linkedWorkId || w.linkedWorkId === work.id) ?? []
  const target = options.some((w) => w.id === picked) ? picked : ''
  const shown = filterByName(options, query)
  // 고른 세계관이 검색으로 목록에서 빠지면 선택을 비운다(보이지 않는 세계관으로 연결하지 않고, 검색어를 지워도 되살아나지 않는다).
  const search = (value: string) => {
    setQuery(value)
    if (!filterByName(options, value).some((w) => w.id === picked)) setPicked('')
  }
  // 경고 없이 해제할 때는 옵션 없이 보낸다(호출 쪽이 기존 확인을 묻는다). 대화 상자를 거쳤으면 옵션을 함께 보내 다시 묻지 않게 한다.
  const release = (options?: WorldRelease) => {
    setPicked(''); setQuery(''); close()
    // 해제하면 초점이 있던 버튼이 사라지므로 성공했을 때 연결 구역의 제목으로 옮긴다(아니면 초점이 문서 처음으로 떨어진다).
    void (options ? onLink(null, options) : onLink(null)).then((ok) => { if (ok) title.current?.focus() })
  }
  // 해제를 누르면 그때 세계관 목록을 한 번 다시 읽어 최신 공개 여부로 정한다: 비공개면 바로 해제(기존 확인), 공개면 비공개 선택지가 있는 경고, 읽지 못했거나 목록에 없으면 공개 여부를 모르는 경고.
  // 읽는 동안 버튼은 disabled가 아니라 aria-disabled로 잠근다: disabled가 되면 초점을 잃어 경고 상자를 닫은 뒤 돌아갈 곳이 없다.
  const detach = async () => {
    const id = await onDetach()
    if (id) navigate('/worldstudio/' + id)
  }
  return (
    <>
      {work.source && !linked && <InheritedWorldCard workId={work.id} sourceTitle={work.source.title} busy={busy} error={detachError} onDetach={detach} useCase={useCase} />}
      <section className='tcard ep-card' aria-label='세계관 연결'>
        <h3 ref={title} tabIndex={-1}>세계관 연결</h3>
        {!linked && <p className='ep-muted'>세계관 하나는 소설 하나에만 연결돼요. 독자 설정 위키는 연결한 세계관의 확정 버전에서 발행된 마지막 회차까지 공개된 설정 카드를 보여 줘요.</p>}
        {linked
          ? (
            <>
              <p>연결된 세계관: <Go to={`/worldstudio/${linked}`}>{linkedWorld?.name ?? '세계관 열기'}</Go></p>
              <div className='ep-card-actions'>
                <button type='button' className='btn sm' disabled={busy || isLoading} aria-disabled={checking || undefined} onClick={() => void check(release)}>연결 해제</button>
              </div>
            </>
          )
          : mine && (options.length
            ? (
              <>
                <div className='lq ep-pick-search'>
                  <span aria-hidden='true'>🔍</span>
                  <input type='search' value={query} onChange={(e) => search(e.target.value)} placeholder='세계관 이름으로 검색' aria-label='세계관 검색' disabled={busy} />
                </div>
                <form className='ep-edit ep-pick-form' onSubmit={(e) => { e.preventDefault(); if (target) void onLink(target) }}>
                  <fieldset disabled={busy}>
                    <fieldset>
                      <legend className='sr-only'>연결할 세계관</legend>
                      {shown.length
                        ? (
                          <div className='ep-pick'>
                            {shown.map((w) => <WorldChoice key={w.id} world={w} group={group} checked={target === w.id} onPick={() => setPicked(w.id)} api={worlds} />)}
                          </div>
                        )
                        : <p role='status' className='ep-muted'>검색 결과가 없어요</p>}
                    </fieldset>
                    <div className='ep-card-actions'>
                      <button className='btn pri sm' disabled={!target} aria-describedby={target ? undefined : hint}>세계관 연결</button>
                      {!target && <span id={hint} className='small ep-muted'>연결할 세계관을 먼저 골라 주세요.</span>}
                    </div>
                  </fieldset>
                </form>
              </>
            )
            : (
              <>
                <p>연결할 수 있는 내 세계관이 없어요. 다른 소설에 연결되지 않은 세계관만 연결할 수 있어요.</p>
                <div className='ep-card-actions'><Go to='/worldstudio' className='btn sm'>세계관 만들기</Go></div>
              </>
            ))}
        {warning && <WorldReleaseWarning known={!!warning.world} onPrivate={() => release({ makePrivate: { genre: warning.world?.genre ?? null } })} onKeep={() => release({})} onCancel={close} />}
        {error && <p className='ep-alert' role='alert'>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        {isError
          ? (
            <>
              <p className='ep-alert' role='alert'>내 세계관을 불러오지 못했어요.</p>
              <div className='ep-card-actions'>
                <button type='button' className='btn sm' onClick={retry}>내 세계관 다시 불러오기</button>
              </div>
            </>
          )
          : isLoading && <p role='status'>내 세계관을 불러오고 있어요…</p>}
      </section>
    </>
  )
}

type ChoiceProps = { world: StudioWorld; group: string; checked: boolean; onPick: () => void; api: Pick<WorldStudioUseCase, 'cover' | 'supportsCover'> }

/**
 * 고를 세계관 한 장: 검색 화면(`/search`)의 세계관 카드와 같은 3:4 표지·이름·`설정 카드 N개`이고, 카드 전체가 라디오 하나다.
 * 입력만 화면에서 숨겨(`sr-only`) 키보드·스크린리더는 네이티브 라디오 그룹 그대로이고, 이름은 세계관 이름·설명은 카드 수로 읽힌다. 고른 카드는 `선택됨` 알약과 윤곽선으로 보인다.
 * 올린 표지는 서재 `MyWorlds`처럼 소유자 인증으로 읽고, 없거나 읽지 못하면 기본 표지다. 읽는 동안은 빈 칸이라 기본 표지에서 바뀌며 깜빡이지 않는다.
 */
function WorldChoice({ world: w, group, checked, onPick, api }: ChoiceProps) {
  const id = useId()
  const reads = !!w.hasCover && api.supportsCover
  const { url, error } = useWorldCoverImage(api, w.id, reads, 0)
  return (
    <label className='bk ep-pick-card'>
      <input type='radio' className='sr-only' name={group} checked={checked} onChange={onPick} aria-labelledby={`${id}n`} aria-describedby={`${id}m`} />
      <div className='cov'>
        {(!reads || url || error) && <img src={coverSrc(url)} alt='' />}
        {checked && <span className='lk' aria-hidden='true'>선택됨</span>}
      </div>
      <span id={`${id}n`} className='hk'>{w.name}</span>
      <small id={`${id}m`}>설정 카드 {w.cardCount ?? w.settings.length}개</small>
    </label>
  )
}

type InheritedProps = { workId: string; sourceTitle: string; busy: boolean; error?: string; onDetach: () => void; useCase?: Pick<EpisodeUseCase, 'inheritedWorld'> }

/**
 * 자기 세계관이 없는 Fork가 이어받는 원작 세계관: 읽기 전용으로 '원작 「제목」 세계관을 N화 기준으로 이어받는 중'과 카드 유형별 수·제목·관계 수를 보인다.
 * 이어받는 것이 없으면(서버가 worldId null) 카드를 그리지 않고, 읽지 못하면 빈 상태로 바꾸지 않고 실패와 다시 불러오기로 알린다.
 * 이어받은 카드가 없으면 독립할 것이 없어 버튼을 잠근다(서버도 409). 관계 상태를 모르면 0개로 채우지 않고 알린다.
 * ponytail: 카드 제목을 유형별로 모두 이어 붙인다. 수백 장이 되면 접거나 나눠 보이는 UI가 필요하다.
 */
function InheritedWorldCard({ workId, sourceTitle, busy, error, onDetach, useCase }: InheritedProps) {
  const { data, isLoading, isError, retry } = useInheritedWorld(workId, useCase)
  const empty = useId()
  if (data === null) return null
  return (
    <section className='tcard ep-card' aria-label='이어받는 원작 세계관'>
      <h3>이어받는 원작 세계관</h3>
      {data && (
        <>
          <p>원작 「{sourceTitle}」 세계관을 {data.upto}화 기준으로 이어받는 중</p>
          <p className='ep-muted'>읽기 전용이라 고칠 수 없어요. 내 세계관으로 만들면 이 카드와 관계를 복사해 이 소설에 연결하고, 그 뒤로는 원작 세계관이 바뀌어도 따라오지 않아요.</p>
          {data.cards.length
            ? (
              <dl className='ep-facts'>
                {inheritedCardGroups(data.cards).map((group) => <div key={group.type}><dt>{group.label} {group.cards.length}</dt><dd>{group.cards.map((card) => card.title).join(', ')}</dd></div>)}
                <div><dt>관계</dt><dd>{data.relationshipCount === null ? '불러오지 못했어요' : data.relationshipCount + '개'}</dd></div>
              </dl>
            )
            : <p id={empty}>이어받은 카드가 없어서 독립할 수 없어요.</p>}
          <div className='ep-card-actions'>
            <button type='button' className='btn pri sm' disabled={busy || !data.cards.length} aria-describedby={data.cards.length ? undefined : empty} onClick={onDetach}>내 세계관으로 만들어 수정하기</button>
          </div>
        </>
      )}
      {error && <p className='ep-alert' role='alert'>{error}</p>}
      {isError
        ? (
          <>
            <p className='ep-alert' role='alert'>원작 세계관을 불러오지 못했어요.</p>
            <div className='ep-card-actions'>
              <button type='button' className='btn sm' onClick={retry}>원작 세계관 다시 불러오기</button>
            </div>
          </>
        )
        : isLoading && <p role='status'>원작 세계관을 불러오고 있어요…</p>}
    </section>
  )
}

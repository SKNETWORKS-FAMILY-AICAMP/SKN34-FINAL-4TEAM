import { useId, useState } from 'react'
import { useNavigate } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { inheritedCardGroups, type Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { Go } from '../../../shared/Go'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useInheritedWorld } from '../viewmodel/useInheritedWorld'

type Props = {
  work: Pick<Work, 'id' | 'worldStudioId' | 'source'>
  /** 작품 관리 화면이 다른 요청을 처리하는 중이면 연결·해제를 잠근다. */
  busy: boolean
  /** 연결(세계관 id)·해제(null)를 서버에 보낸다. 결과 안내와 실패 사유는 호출한 쪽이 error·notice로 넘겨 이 카드 안에 보인다. */
  onLink: (worldId: string | null) => Promise<boolean>
  /** 이어받는 원작 세계관을 내 세계관으로 독립시킨다. 새 세계관 id를 돌려주면(취소·실패는 null) 그 관리 화면으로 간다. 실패 사유는 호출한 쪽이 detachError로 넘겨 이어받는 세계관 카드 안에 보인다. */
  onDetach: () => Promise<string | null>
  /** 이 카드에서 보낸 연결·해제의 실패 사유와 완료 안내(다른 요청의 것은 넘기지 않는다) */
  error?: string
  notice?: string
  /** 이 화면에서 보낸 독립 요청의 실패 사유(이어받는 세계관 카드 안에 보인다) */
  detachError?: string
  /** 테스트가 넣는 이어받는 세계관 조회 대역 */
  useCase?: Pick<EpisodeUseCase, 'inheritedWorld'>
  /** 테스트가 넣는 내 세계관 조회 대역 */
  worlds?: Pick<WorldStudioUseCase, 'list'>
}

/**
 * 세계관·설정집 탭의 세계관 연결(DEC-46): 소설과 내 세계관(WorldStudio)은 1:1로 연결한다.
 * 연결돼 있으면 그 세계관 관리 화면으로 가는 이름과 `연결 해제`를, 아니면 다른 소설에 연결되지 않은 내 세계관을 골라 `세계관 연결`을 보인다. 1:1·독자 위키 공개 범위 설명은 고를 때 필요한 정보라 연결 전에만 보인다.
 * 드롭다운 기본값은 `선택 안 함`이라 고르기 전에는 버튼이 잠기고 이유를 알린다(UC-24 E1: 세계관을 고르지 않으면 연결하지 않는다). 해제하면 고른 값도 비워, 다시 나타난 양식이 직전에 연결했던 세계관을 고른 채 시작하지 않는다.
 * 내 세계관 목록은 탭을 열 때 공용 `useAsyncData`로 읽고 불러오는 중·실패(다시 불러오기)·고를 세계관 없음을 따로 알린다. 다시 읽기가 실패해도 앞서 읽은 목록은 남기고 실패를 함께 알린다.
 * 자기 세계관이 없는 Fork는 이 카드 위에 `이어받는 원작 세계관` 카드를 따로 둔다(#583, DEC-37): 원작 세계관을 읽기 전용으로 보이고 `내 세계관으로 만들어 수정하기`로 독립한다. 성공하면 새 세계관 관리 화면으로 간다.
 * ponytail: 연결·해제 뒤 목록을 다시 읽지 않는다. 그 사이 다른 곳에서 연결이 바뀌었으면 서버가 409로 거절하고 그 사유가 이 카드 안에 보인다.
 */
export function LinkedWorldPanel({ work, busy, onLink, onDetach, error, notice, detachError, useCase, worlds = appContainer.resolve('worldStudioUseCase') }: Props) {
  const navigate = useNavigate()
  const { data: mine, isLoading, isError, retry } = useAsyncData((signal) => worlds.list(signal), [worlds])
  const [picked, setPicked] = useState('')
  const hint = useId()
  const linked = work.worldStudioId
  // 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 목록에 아직 이 소설로 적혀 있으므로 함께 고를 수 있게 둔다.
  const options = mine?.filter((w) => !w.linkedWorkId || w.linkedWorkId === work.id) ?? []
  const target = options.some((w) => w.id === picked) ? picked : ''
  const detach = async () => {
    const id = await onDetach()
    if (id) navigate('/worldstudio/' + id)
  }
  return (
    <>
      {work.source && !linked && <InheritedWorldCard workId={work.id} sourceTitle={work.source.title} busy={busy} error={detachError} onDetach={detach} useCase={useCase} />}
      <section className='ep-card' aria-label='세계관 연결'>
        <h3>세계관 연결</h3>
        {!linked && <p className='ep-muted'>세계관 하나는 소설 하나에만 연결돼요. 독자 설정 위키는 연결한 세계관의 확정 버전에서 발행된 마지막 회차까지 공개된 설정 카드를 보여 줘요.</p>}
        {linked
          ? (
            <>
              <p>연결된 세계관: <Go to={`/worldstudio/${linked}`}>{mine?.find((w) => w.id === linked)?.name ?? '세계관 열기'}</Go></p>
              <div className='ep-card-actions'>
                <button type='button' className='btn sm' disabled={busy} onClick={() => { setPicked(''); void onLink(null) }}>연결 해제</button>
              </div>
            </>
          )
          : mine && (options.length
            ? (
              <form className='ep-edit' onSubmit={(e) => { e.preventDefault(); if (target) void onLink(target) }}>
                <fieldset disabled={busy}>
                  <label>
                    연결할 세계관
                    <select value={target} onChange={(e) => setPicked(e.target.value)}>
                      <option value=''>선택 안 함</option>
                      {options.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </label>
                  <div className='ep-card-actions'>
                    <button className='btn pri sm' disabled={!target} aria-describedby={target ? undefined : hint}>세계관 연결</button>
                    {!target && <span id={hint} className='small ep-muted'>연결할 세계관을 먼저 골라 주세요.</span>}
                  </div>
                </fieldset>
              </form>
            )
            : (
              <>
                <p>연결할 수 있는 내 세계관이 없어요. 다른 소설에 연결되지 않은 세계관만 연결할 수 있어요.</p>
                <div className='ep-card-actions'><Go to='/worldstudio' className='btn sm'>세계관 만들기</Go></div>
              </>
            ))}
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

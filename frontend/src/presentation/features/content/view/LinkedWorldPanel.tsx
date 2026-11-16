import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { Work } from '../../../../domain/entities/content'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { Go } from '../../../shared/Go'
import { useAsyncData } from '../../../shared/useAsyncData'

type Props = {
  work: Pick<Work, 'id' | 'worldStudioId'>
  /** 작품 관리 화면이 다른 요청을 처리하는 중이면 연결·해제를 잠근다. */
  busy: boolean
  /** 연결(세계관 id)·해제(null)를 서버에 보낸다. 결과 안내와 실패 사유는 호출한 쪽이 error·notice로 넘겨 이 카드 안에 보인다. */
  onLink: (worldId: string | null) => Promise<boolean>
  /** 이 카드에서 보낸 연결·해제의 실패 사유와 완료 안내(다른 요청의 것은 넘기지 않는다) */
  error?: string
  notice?: string
  /** 테스트가 넣는 내 세계관 조회 대역 */
  worlds?: Pick<WorldStudioUseCase, 'list'>
}

/**
 * 세계관·설정집 탭의 세계관 연결(DEC-46): 소설과 내 세계관(WorldStudio)은 1:1로 연결한다.
 * 연결돼 있으면 그 세계관 관리 화면으로 가는 이름과 `연결 해제`를, 아니면 다른 소설에 연결되지 않은 내 세계관을 골라 `세계관 연결`을 보인다.
 * 내 세계관 목록은 탭을 열 때 공용 `useAsyncData`로 읽고 불러오는 중·실패(다시 불러오기)·고를 세계관 없음을 따로 알린다. 다시 읽기가 실패해도 앞서 읽은 목록은 남기고 실패를 함께 알린다.
 * ponytail: 연결·해제 뒤 목록을 다시 읽지 않는다. 그 사이 다른 곳에서 연결이 바뀌었으면 서버가 409로 거절하고 그 사유가 이 카드 안에 보인다.
 */
export function LinkedWorldPanel({ work, busy, onLink, error, notice, worlds = appContainer.resolve('worldStudioUseCase') }: Props) {
  const { data: mine, isLoading, isError, retry } = useAsyncData((signal) => worlds.list(signal), [worlds])
  const [picked, setPicked] = useState('')
  const linked = work.worldStudioId
  // 목록을 읽은 뒤 이 소설에서 연결을 푼 세계관은 목록에 아직 이 소설로 적혀 있으므로 함께 고를 수 있게 둔다.
  const options = mine?.filter((w) => !w.linkedWorkId || w.linkedWorkId === work.id) ?? []
  const target = options.some((w) => w.id === picked) ? picked : options[0]?.id
  return (
    <section className='tcard ep-card' aria-label='세계관 연결'>
      <h2>세계관 연결</h2>
      <p className='ep-muted'>세계관 하나는 소설 하나에만 연결돼요. 독자 설정 위키는 연결한 세계관의 확정 버전에서 독자 공개 회차를 정한 설정 카드를 보여 줘요.</p>
      {linked
        ? (
          <>
            <p>연결된 세계관: <Go to={`/worldstudio/${linked}`}>{mine?.find((w) => w.id === linked)?.name ?? '세계관 열기'}</Go></p>
            <div className='ep-card-actions'>
              <button type='button' className='btn sm' disabled={busy} onClick={() => void onLink(null)}>연결 해제</button>
            </div>
          </>
        )
        : mine && (target
          ? (
            <form className='ep-edit' onSubmit={(e) => { e.preventDefault(); void onLink(target) }}>
              <fieldset disabled={busy}>
                <label>
                  연결할 세계관
                  <select value={target} onChange={(e) => setPicked(e.target.value)}>
                    {options.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                <div className='ep-edit-actions'>
                  <button className='btn pri sm'>세계관 연결</button>
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
  )
}

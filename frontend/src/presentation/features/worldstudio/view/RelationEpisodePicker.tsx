import { useEffect, useId, useRef, useState } from 'react'
import { relationEpisodeInput } from '../../../../domain/entities/studioWorld'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>

const textOf = (episode: number | null) => (episode === null ? '' : String(episode))

/**
 * 관계 기준 회차(DEC-51). 연결된 소설의 회차를 고르면 그 회차 시점의 관계로 다시 읽고, 세계관을 저장하면 그 회차의 관계로 기록한다(비워 두면 최신 회차).
 * 회차를 바꾸면 관계 편집기는 새로 열리지만(`relationKey`) 이 칸은 그 바깥이라 그대로다. 요청 중에는 칸이 잠겨 초점이 body로 빠지므로, 이 칸에서 시작한 요청이 끝나면 입력 칸으로 돌려준다.
 * 다른 길(AI 반영·확정 버전 뒤 재조회)로 회차가 바뀌면 입력 칸도 따라간다. 관계 편집기의 연결 안내가 이 화면의 유일한 `role="status"`라 여기서는 쓰지 않는다.
 */
export function RelationEpisodePicker({ studio }: { studio: VM }) {
  const id = useId()
  const { episode, episodeLock: lock } = studio
  const [text, setText] = useState(textOf(episode))
  const [shown, setShown] = useState(episode)
  if (shown !== episode) { setShown(episode); setText(textOf(episode)) } // 렌더 중 상태 맞춤(effect 없이 prop 변경을 따른다)
  const input = relationEpisodeInput(text)
  const error = 'error' in input ? input.error : ''
  const off = !!lock || studio.busy
  const field = useRef<HTMLInputElement>(null), refocus = useRef(false)
  useEffect(() => {
    if (studio.busy || !refocus.current) return
    refocus.current = false
    field.current?.focus()
  }, [studio.busy])
  const pick = (next: number | null) => {
    if (studio.selectEpisode(next)) refocus.current = true // 요청이 시작됐을 때만(잠겼거나 같은 회차면 시작하지 않는다)
  }
  return (
    <section className='relationship-episode' aria-label='관계 기준 회차'>
      <form onSubmit={(e) => { e.preventDefault(); if ('episode' in input && !off) pick(input.episode) }}>
        <label htmlFor={id}>관계 기준 회차</label>
        <input
          ref={field}
          id={id}
          type='text'
          inputMode='numeric'
          autoComplete='off'
          className='inp'
          placeholder='최신'
          value={text}
          disabled={off}
          aria-invalid={!!error}
          aria-describedby={`${error ? `${id}-error ` : ''}${id}-help`}
          onChange={(e) => setText(e.target.value)}
        />
        화
        <button className='btn sm' type='submit' disabled={off || !!error || ('episode' in input && input.episode === episode)}>이 회차 관계 보기</button>
        <button className='btn sm' type='button' disabled={off || episode === null} onClick={() => pick(null)}>최신으로</button>
      </form>
      {error && <p id={`${id}-error`} role='alert' className='small world-field-error'>{error}</p>}
      <p id={`${id}-help`} className='small muted'>{lock || (episode === null ? '지금은 최신 회차의 관계예요.' : `지금은 ${episode}화 시점의 관계예요.`)}</p>
      <p className='small muted'>비워 두면 최신 회차예요. 세계관을 저장하면 이 회차의 관계로 기록하고, 설정 카드의 변경은 회차와 상관없이 그대로 저장돼요.</p>
    </section>
  )
}

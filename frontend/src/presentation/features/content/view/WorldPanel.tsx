import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useWorldViewModel } from '../viewmodel/useWorldViewModel'

/**
 * 세계관·설정집 탭: 설정집 요약(이름·상태·최초 분기 기준)만 보여 준다.
 * 설정 항목 편집·원작 변경 반영·첨부·버전 복원은 세계관 스튜디오에서 하도록 옮길 예정이라 이 화면에서는 하지 않는다.
 * ponytail: 세계관 스튜디오 연결은 후속이라 '세계관 스튜디오에서 관리'는 비활성이다. 설정집 읽기는 useWorldViewModel을 그대로 쓴다.
 */
export function WorldPanel({ workId, useCase }: { workId: string; useCase?: EpisodeUseCase }) {
  const vm = useWorldViewModel(workId, useCase)
  const w = vm.world
  if (!w) {
    return (
      <section className='tcard ep-card'>
        <p role={vm.error ? 'alert' : 'status'}>{vm.error || '설정집을 불러오고 있어요…'}</p>
        {vm.error && (
          <div className='ep-card-actions'>
            <button type='button' className='btn sm' disabled={vm.busy} onClick={vm.reload}>설정집 다시 불러오기</button>
          </div>
        )}
      </section>
    )
  }
  return (
    <section className='tcard ep-card' aria-label='세계관 설정집'>
      <h2>{w.name}</h2>
      <p>
        {w.mode === 'following'
          ? '원작 추종 중 · 첫 설정 수정 시 전체 공개 설정이 독립해요.'
          : w.mode === 'independent'
          ? '독립 세계관 · 원작 변경은 선택해서 반영해요.'
          : '내 작품의 세계관 · 확정 설정만 문맥에 사용해요.'}
      </p>
      {w.basis && <p>{`최초 분기 기준: ${w.basis.episode}화 · 원고 버전 ${w.basis.version} · 설정 ${w.basis.settings.length}개`}</p>}
      <div className='ep-card-actions'>
        <button type='button' className='btn sm' disabled>세계관 스튜디오에서 관리</button>
        <span className='chip'>연결 예정</span>
      </div>
    </section>
  )
}

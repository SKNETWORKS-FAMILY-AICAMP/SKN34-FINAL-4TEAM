import { Sheet } from '../Sheet'
import { useOnboardingViewModel } from './useOnboardingViewModel'

/** 핵심 흐름 4단계(#884 이슈 배경의 순서). 문구는 초안이다. */
const STEPS = [
  { title: '작품 읽기', text: '홈에서 마음에 드는 작품을 골라 공개된 회차를 읽어요.' },
  { title: 'Fork', text: '이용이 허용된 원작은 원하는 회차에서 이야기를 갈라(Fork) 나만의 작품으로 이어 쓸 수 있어요.' },
  { title: '집필실', text: '내 작품은 집필실에서 회차별로 직접 쓰고 저장해요.' },
  { title: 'AI 집필·피드백', text: '필요할 때 AI에게 집필 제안을 받고 독자 피드백을 확인해요.' },
]

/** U46 첫 방문 안내 (#884) */
export function OnboardingSheet() {
  const vm = useOnboardingViewModel()
  if (!vm.open) return null
  return (
    <Sheet sid="U46" label="처음 오셨나요?" onClose={vm.skip}>
      <div className="sh-h"><h3>처음 오셨나요?</h3><button type="button" className="x" aria-label="닫기" onClick={vm.skip}>✕</button></div>
      <p>STORYFORK는 원작을 읽고, 원하는 회차에서 나만의 이야기로 이어 쓰는 곳이에요.</p>
      <ol>{STEPS.map((s) => <li key={s.title}><b>{s.title}</b> — {s.text}</li>)}</ol>
      <div className="rowend">
        <button type="button" className="btn" onClick={vm.dismiss}>다시 보지 않기</button>
        <button type="button" className="btn pri" onClick={vm.skip}>건너뛰기</button>
      </div>
    </Sheet>
  )
}

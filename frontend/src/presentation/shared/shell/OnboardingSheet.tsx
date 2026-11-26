import { Go } from '../Go'
import { Sheet } from '../Sheet'
import { useOnboardingViewModel } from './useOnboardingViewModel'

/**
 * 핵심 흐름 4단계(#884 이슈 배경의 순서). 문구는 초안이다.
 * 바로가기(#930): 작품 읽기는 안내를 닫고 홈 목록을, Fork는 포크 소설 목록(`/rank?t=if`)을, 집필실은 서재의 내가 쓰는 소설(U12)을 연다. AI 단계는 작품 안에서 쓰므로 바로가기가 없다.
 * Fork 바로가기는 로그인 없이 보는 읽기 전용 화면으로 둔다: 읽기 전용 Fork 안내 화면이 따로 없어, 홈의 '다르게 이어진 포크 소설' 섹션이 '전체 보기'로 여는 같은 목록을 쓴다.
 */
const STEPS: { title: string; text: string; link?: { to: string; label: string } }[] = [
  { title: '작품 읽기', text: '홈에서 마음에 드는 작품을 골라 공개된 회차를 읽어요.', link: { to: '/', label: '홈 목록 보기' } },
  { title: 'Fork', text: '이용이 허용된 원작은 원하는 회차에서 이야기를 갈라(Fork) 나만의 작품으로 이어 쓸 수 있어요.', link: { to: '/rank?t=if', label: '포크 소설 둘러보기' } },
  { title: '집필실', text: '내 작품은 집필실에서 회차별로 직접 쓰고 저장해요.', link: { to: '/lib?tab=write', label: '내가 쓰는 소설로 가기' } },
  { title: 'AI 집필·피드백', text: '필요할 때 AI에게 집필 제안을 받고 독자 피드백을 확인해요.' },
]

/** U46 첫 방문 안내 (#884, #930) */
export function OnboardingSheet() {
  const vm = useOnboardingViewModel()
  if (!vm.open) return null
  return (
    <Sheet sid="U46" label="처음 오셨나요?" onClose={vm.skip}>
      <div className="sh-h"><h3>처음 오셨나요?</h3><button type="button" className="x" aria-label="닫기" onClick={vm.skip}>✕</button></div>
      <p>STORYFORK는 원작을 읽고, 원하는 회차에서 나만의 이야기로 이어 쓰는 곳이에요.</p>
      <ol className="onb-steps">{STEPS.map((s) => (
        <li key={s.title}>
          <b>{s.title}</b> — {s.text}
          {s.link && <> <Go to={s.link.to} onClick={vm.skip}>{s.link.label}</Go></>}
        </li>
      ))}</ol>
      <div className="rowend">
        <button type="button" className="btn" onClick={vm.dismiss} aria-describedby="onboarding-dismiss-note">다시 보지 않기</button>
        <span id="onboarding-dismiss-note" className="muted small">다음 방문에도 보이지 않아요</span>
        <button type="button" className="btn" onClick={vm.skip}>건너뛰기</button>
        <button type="button" className="btn pri" onClick={vm.skip}>작품 둘러보기</button>
      </div>
    </Sheet>
  )
}

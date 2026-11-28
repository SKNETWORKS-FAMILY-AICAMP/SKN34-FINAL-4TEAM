import { useState } from 'react'

import { Go } from '../Go'
import { Sheet } from '../Sheet'
import { useOnboardingViewModel } from './useOnboardingViewModel'

/**
 * 핵심 흐름 4단계(#884 이슈 배경의 순서). 문구는 초안이다.
 * 바로가기(#930): Fork는 포크 소설 목록(`/rank?t=if`)을, 집필실은 서재의 내가 쓰는 소설(U12)을 연다. 작품 읽기는 홈 위에서 여는 시트라
 * 주 버튼 `작품 둘러보기`가 같은 일을 해 바로가기를 두지 않고(UX 개선), AI 단계는 작품 안에서 쓰므로 바로가기가 없다.
 * Fork 바로가기는 로그인 없이 보는 읽기 전용 화면으로 둔다: 읽기 전용 Fork 안내 화면이 따로 없어, 홈의 '다르게 이어진 포크 소설' 섹션이 '전체 보기'로 여는 같은 목록을 쓴다.
 */
const STEPS: { title: string; text: string; link?: { to: string; label: string } }[] = [
  { title: '작품 읽기', text: '마음에 드는 작품을 골라 공개된 회차를 읽어요.' },
  { title: 'Fork', text: '이용이 허용되고 세계관이 연결된 원작은 원하는 회차에서 갈라 나만의 이야기로 이어 써요.', link: { to: '/rank?t=if', label: '포크 소설 둘러보기' } },
  { title: '집필실', text: '내 작품을 회차별로 직접 쓰고 저장해요.', link: { to: '/lib?tab=write', label: '내가 쓰는 소설로 가기' } },
  { title: 'AI 집필·피드백', text: '집필실에서 AI에게 집필 제안을 받고, 독자 피드백을 확인해요.' },
]

/**
 * U46 첫 방문 안내 (#884, #930). 닫는 길은 닫기(✕)·Esc·주 버튼·바로가기이고 모두 이번 방문만 닫는다.
 * '다음부터 보지 않기'를 고른 채 닫으면 그 닫기가 이 브라우저에 기억한다(예전 건너뛰기·다시 보지 않기 버튼을 선택 하나로 합침, UX 개선).
 */
export function OnboardingSheet() {
  const vm = useOnboardingViewModel()
  const [never, setNever] = useState(false)
  if (!vm.open) return null
  const close = never ? vm.dismiss : vm.skip
  return (
    <Sheet sid="U46" label="처음 오셨나요?" onClose={close}>
      <div className="sh-h"><h3>처음 오셨나요?</h3><button type="button" className="x" aria-label="닫기" onClick={close}>✕</button></div>
      <p>STORYFORK는 원작을 읽고, 원하는 회차에서 나만의 이야기로 이어 쓰는 곳이에요.</p>
      <ol className="onb-steps">{STEPS.map((s) => (
        <li key={s.title}>
          <b>{s.title}</b>{s.text}
          {s.link && <> <Go to={s.link.to} onClick={close}>{s.link.label}</Go></>}
        </li>
      ))}</ol>
      <p className="muted small">읽다가 문장을 누르면 작가에게 오류 제보나 수정 제안을 보낼 수 있어요.</p>
      <p className="muted small">작가 도구에서는 <b>사용법</b> 버튼으로 그 화면의 안내를 다시 볼 수 있어요.</p>
      <div className="onb-foot">
        <label className="onb-never"><input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} /> 다음부터 보지 않기</label>
        <button type="button" className="btn pri" onClick={close}>작품 둘러보기</button>
      </div>
    </Sheet>
  )
}

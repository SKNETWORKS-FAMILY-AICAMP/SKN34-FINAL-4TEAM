import { Sheet } from '../Sheet'
import { usePolicyViewModel } from './usePolicyViewModel'

/** 목업 policySheet(): U23 크레딧·이용 정책 안내 (P2) */
export function PolicySheet() {
  const vm = usePolicyViewModel()
  if (!vm.open || !vm.data) return null
  const s = vm.data
  const mockup = import.meta.env.MODE === 'mockup'
  return (
    <Sheet sid="U23" label="크레딧·이용 정책 안내" onClose={vm.close}>
      <div className="sh-h"><h3>크레딧·이용 정책 안내</h3><button type="button" className="x" aria-label="닫기" onClick={vm.close}>✕</button></div>
      <div className="policy"><b>P2 · 미확정 정책</b> — 아래 내용은 기획서 V장에서 “검토/추후 확정”으로 남아 있어{mockup ? ' 이 목업에서는 가상 시연만 해요. 실제 잔액 차감이나 결제는 일어나지 않아요.' : '요.'}</div>
      <table><tbody>
        <tr><th>항목</th><th>기획서 기준</th>{mockup && <th>목업 처리</th>}</tr>
        <tr><td>포크 생성·직접 집필</td><td>무료</td>{mockup && <td>동작함</td>}</tr>
        <tr><td>AI 창작 지원</td><td>크레딧 과금, 실행 전 안내 (차감 기준 미정)</td>{mockup && <td>예시 숫자만 표시, 차감 없음</td>}</tr>
        <tr><td>소설 열람</td><td>이용허락에 따라 무료/유료</td>{mockup && <td>전부 무료로 표시</td>}</tr>
        <tr><td>수익 배분·인기작 크레딧 보상</td><td>추후 확정</td>{mockup && <td>비활성 (설명만)</td>}</tr>
        <tr><td>저장 공간 유료 확장</td><td>추후 확정</td>{mockup && <td>비활성 (설명만)</td>}</tr>
        <tr><td>AI 자율 연재</td><td>기획 (IV-5) · 독자 반응 반영은 검토</td>{mockup && <td>운영 설정 집필 방식에서 AI 자율 집필 선택 · 1화만 직접 집필 · 회차별 다음 전개 투표(AI 4지선다)·제안 게시판 · 검수 후 자동 발행</td>}</tr>
      </tbody></table>
      {mockup ? <>
        <label className="field"><span><input type="checkbox" id="demoFail" checked={s.failNext} onChange={(e) => vm.setFailNext(e.target.checked)} /> 다음 AI 요청 실패 시연</span></label>
        <div className="note">데모 잔액 {s.credits} · 사용 기록 {s.usage.length}건. 실제 결제나 차감은 없습니다.</div>
        <ul>{s.usage.map((u, i) => <li key={i}>{u.task} · 예시 {u.cost}</li>)}</ul>
        <div className="note">집필실의 30 / 5 / 5는 디자인 v3에서 쓰던 <b>예시 숫자</b>예요. 확정된 가격이 아니에요.</div>
      </> : <div className="note">보유 크레딧과 사용 내역은 이 결제 내역 화면에서 볼 수 있어요.</div>}
      <div className="rowend"><button type="button" className="btn pri" onClick={vm.close}>확인</button></div>
    </Sheet>
  )
}

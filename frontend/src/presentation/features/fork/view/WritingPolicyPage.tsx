import { useState } from 'react'
import { Navigate } from 'react-router'

import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWritingPolicyViewModel } from '../viewmodel/useWritingPolicyViewModel'

const TEXT = {
  fork: {
    title: '다른 소설 포크',
    policy: '원작이 허용한 공개 회차에서만 시작할 수 있어요. 분기 시점에 공개된 원고와 세계관·인물 설정은 고정되고, 원작의 이후 변경은 기존 포크에 들어오지 않아요.',
    rights: '원작자 또는 권리자가 허용한 범위에서만 포크하세요. 원작의 저작권과 이용 조건을 따르고, 원작 표시를 유지해 주세요.',
  },
  import: {
    title: '내 소설 가져오기',
    policy: '가져온 원고는 집필을 돕기 위해 정리되는 초안이에요. 가져오기만으로 공개·발행·포크 허용이 설정되지 않으며, 이 데모는 실제 파일을 전송하거나 처리하지 않아요.',
    rights: '직접 창작했거나 필요한 이용·AI 처리 권한을 받은 원고만 가져오세요. 다른 사람의 원고는 권리자의 허락과 조건을 확인해야 하며, 업로드만으로 권리가 생기지 않아요.',
  },
}

/** 목업 writingPolicy(): U43 집필 방식·저작권 안내 */
export function WritingPolicyPage() {
  const vm = useWritingPolicyViewModel()
  const [rule, setRule] = useState(false)
  const [rights, setRights] = useState(false)
  if (!vm.method) return <Navigate replace to="/write" />
  const t = TEXT[vm.method]
  return (
    <>
      <Gnb on="lib" />
      <main className="wrap"><div className="fork newwork-page">
        <Go to="/write" className="back"><BackChev />내가 쓰는 소설</Go>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '14px 0 6px' }}>{t.title} 전 확인</h1>
        <p className="muted">집필 방식과 저작권 안내를 각각 확인해 주세요.</p>
        <section className="tcard fstep" style={{ marginTop: 20 }}><h2>집필 방식과 정책</h2><p style={{ marginTop: 8 }}>{t.policy}</p></section>
        <section className="tcard fstep"><h2>저작권과 이용 권한</h2><p style={{ marginTop: 8 }}>{t.rights}</p></section>
        <form id="writingPolicyForm" onSubmit={(e) => { e.preventDefault(); vm.submit(rule, rights) }}>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', margin: '14px 0' }}><input type="checkbox" id="writingPolicyRule" required checked={rule} onChange={(e) => setRule(e.target.checked)} /><span>이 집필 방식의 정책과 안내를 확인했습니다.</span></label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', margin: '14px 0' }}><input type="checkbox" id="writingPolicyRights" required checked={rights} onChange={(e) => setRights(e.target.checked)} /><span>저작권과 이용 권한 안내를 확인했고, 필요한 권리를 보유했거나 허락받았습니다.</span></label>
          <div className="rowend"><Go to="/write" className="btn">취소</Go><button className="btn pri" type="submit">동의하고 계속</button></div>
        </form>
      </div></main>
      <Footer />
    </>
  )
}

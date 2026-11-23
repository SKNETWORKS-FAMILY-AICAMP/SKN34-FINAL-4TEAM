import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useEpisodeViewModel } from '../viewmodel/useEpisodeViewModel'
import '../../../shared/episode.css'
import { CreateWork } from './CreateWork'
import { WorkActions, WorkManagement } from './WorkManagement'
import { Go } from '../../../shared/Go'
import { MyCommentsReports } from '../../library/view/MyCommentsReports'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'

/**
 * 작품 관리 화면. 주소가 화면을 정한다: `/content`는 새 작품 만들기, `/content?work=<id>`는 그 내 작품의 관리 화면(`&tab=world`면 세계관 탭부터)이고
 * 내 작품이 아니면 안내한다. 작품 목록은 서재(`/lib?tab=write`)가 맡고 원고 작성은 집필실(`/studio/{id}`)이 맡는다.
 * 작품 관리(`?work=`)는 세계관 관리와 같은 사이드바 화면이라 공용 상단바(Gnb)·푸터를 그리지 않고 사이드바(ManageMenu)가 그 역할을 맡는다 — 서재로 돌아가는 링크는 사이드바 맨 위,
 * 접으면 상단 줄(`.ep-top`)에 있다. 새 작품 만들기(`/content`)·내 댓글·제보는 사이드바가 없어 공용 Gnb·Footer가 그대로고, 서재로 돌아가는 링크는 본문 맨 위에 둔다.
 */
export function EpisodePage({ useCase }: { useCase?: EpisodeUseCase }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const wanted = params.get('work')
  const reports = params.get('view') === 'reports'
  const vm = useEpisodeViewModel(wanted, useCase)
  const w = vm.active
  const loading = !!wanted && !vm.ready
  // 작품 관리 주소는 읽는 동안·작품을 찾지 못했을 때도 상단바·푸터를 그리지 않는다: 사이드바가 나타날 때 상단바가 사라지며 화면이 밀리지 않게.
  const shell = !!wanted && !reports
  // 사이드바 접기(901px 이상): 접은 동안 서재로 돌아가는 링크와 주 행동은 상단 줄로 옮겨 그린다. 상단 줄이 이 페이지에 있어 접힘 상태도 여기서 가진다.
  // ponytail: 접힘 상태를 저장하지 않는다(새로 고치면 펼침). 필요하면 한 키로 저장한다.
  const [menuOpen, setMenuOpen] = useState(true)
  // 사이드바(WorkManagement)가 그려지는 작품. 펼친 동안은 돌아가기 링크가 사이드바에 있어 상단 줄을 그리지 않고(두 곳 동시 노출 없음), 오류·상태 알림도 사이드바 위가 아니라 내용 열 맨 위에 그린다.
  const managed = shell && !loading ? w : null
  // 작품 만들기·분기 만들기·세계관 연결의 결과는 그 폼·카드가 직접 보인다(vm.origin). 그 밖의 요청은 여기 맨 위에 알리고,
  // 스크롤해 내려가 있어 알림이 화면 밖에 생겼으면 보이는 데까지만 옮긴다(상단바가 있으면 거기에 가리지 않게 scroll-margin을 둔다).
  const problem = vm.origin === '' ? vm.error : ''
  const alert = useRef<HTMLDivElement>(null)
  useEffect(() => { if (problem) alert.current?.scrollIntoView?.({ block: 'nearest' }) }, [problem])
  useDocumentTitle(reports ? '내 댓글·제보' : !wanted ? '새 작품 만들기' : w ? `작품 관리 · ${w.title}` : '작품 관리')
  const notices = (
    <>
      {problem && (
        <div ref={alert} className='ep-alert' role='alert' style={{ scrollMarginTop: shell ? 16 : 80 }}>
          {problem}
          <button className='btn sm' disabled={vm.busy} onClick={vm.reload}>
            최신 데이터 불러오기
          </button>
        </div>
      )}
      <div className='ep-notice' role='status' aria-live='polite'>
        {loading ? '작품을 불러오고 있어요…' : vm.busy ? '요청을 처리하고 있어요…' : vm.origin === 'link' ? '' : vm.notice}
      </div>
    </>
  )
  return (
    <>
      {!shell && <Gnb on='lib' />}
      <div className='episode-app'>
        <main className='ep-main' id='main' tabIndex={-1}>
          {!(managed && menuOpen) && (
            <div className='ep-top'>
              <Go to='/lib?tab=write' className='ep-back'><BackChev />내가 쓰는 소설</Go>
              {/* 사이드바를 접은 동안은 주 행동도 이 줄에 둔다(사이드바의 도구 묶음과 두 곳에 두지 않는다). */}
              {managed && <div className='ep-top-actions'><WorkActions workId={managed.id} /></div>}
            </div>
          )}
          {!managed && notices}
          {reports
            ? <MyCommentsReports />
            : !wanted
            ? (
              <CreateWork
                busy={vm.busy}
                ready={vm.listed}
                error={vm.origin === 'create' ? vm.error : ''}
                onCreate={async (title, summary, cover, registration) => {
                  const created = await vm.create(title, summary, cover, registration)
                  if (created) {
                    const id = encodeURIComponent(created.id)
                    // 표지까지 성공하면 바로 집필실로(성공 알림은 두지 않는다), 표지만 실패하면 관리 화면에서 오류를 알리고 표지를 다시 올리게 한다. replace라 뒤로 가기로 빈 생성 화면에 돌아오지 않는다.
                    navigate(created.complete ? `/studio/${id}` : `/content?work=${id}`, { replace: true })
                  }
                }}
              />
            )
            : loading
            ? null
            : w
            ? (
              <WorkManagement
                key={w.id}
                vm={vm}
                work={w}
                useCase={useCase}
                initialTab={params.get('tab') === 'world' ? 'world' : undefined}
                onForked={(id) => navigate(`/content?work=${encodeURIComponent(id)}`)}
                onDeleted={() => navigate('/lib?tab=write', { state: { deletedWorkTitle: w.title } })}
                menuOpen={menuOpen}
                onMenuOpenChange={setMenuOpen}
                notices={notices}
              />
            )
            : !vm.error && (
              <section className='ep-create'>
                <h1>작품을 찾을 수 없어요</h1>
                <p className='ep-lead'>내 작품이 아니거나 삭제된 작품이에요.<br />서재에서 내 작품을 골라 주세요.</p>
                <Go to='/lib?tab=write' className='btn'>내가 쓰는 소설로 돌아가기</Go>
              </section>
            )}
        </main>
      </div>
      {!shell && <Footer />}
    </>
  )
}

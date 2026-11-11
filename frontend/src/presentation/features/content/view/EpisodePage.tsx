import { useNavigate, useSearchParams } from 'react-router'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import { useEpisodeViewModel } from '../viewmodel/useEpisodeViewModel'
import './episode.css'
import { CreateWork } from './CreateWork'
import { WorkManagement } from './WorkManagement'
import { Go } from '../../../shared/Go'
import { MyCommentsReports } from '../../library/view/MyCommentsReports'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'

/**
 * 작품 관리 화면. 주소가 화면을 정한다: `/content`는 새 작품 만들기, `/content?work=<id>`는 그 내 작품의 관리 화면이고
 * 내 작품이 아니면 안내한다. 작품 목록은 서재(`/lib?tab=write`)가 맡고 원고 작성은 집필실(`/studio/{id}`)이 맡는다.
 * 상단바·푸터는 다른 관리 화면과 같은 공용 Gnb·Footer이고, 서재로 돌아가는 링크는 본문 맨 위에 둔다.
 */
export function EpisodePage({ useCase }: { useCase?: EpisodeUseCase }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const wanted = params.get('work')
  const reports = params.get('view') === 'reports'
  const vm = useEpisodeViewModel(wanted, useCase)
  const w = vm.active
  const loading = !!wanted && !vm.ready
  useDocumentTitle(reports ? '내 댓글·제보' : !wanted ? '새 작품 만들기' : w ? `작품 관리 · ${w.title}` : '작품 관리')
  return (
    <>
      <Gnb on='lib' />
      <div className='episode-app'>
        <main className='ep-main' id='main' tabIndex={-1}>
          <Go to='/lib?tab=write' className='ep-back'><BackChev />내가 쓰는 소설</Go>
          {!reports && <Go to='/content?view=reports' className='btn sm'>내 댓글·제보</Go>}
          {vm.error && (
            <div className='ep-alert' role='alert'>
              {vm.error}
              <button className='btn sm' disabled={vm.busy} onClick={vm.reload}>
                최신 데이터 불러오기
              </button>
            </div>
          )}
          <div className='ep-notice' role='status' aria-live='polite'>
            {loading ? '작품을 불러오고 있어요…' : vm.busy ? '요청을 처리하고 있어요…' : vm.notice}
          </div>
          {reports
            ? <MyCommentsReports />
            : !wanted
            ? (
              <CreateWork
                busy={vm.busy}
                ready={vm.ready}
                onCreate={async (title, summary, cover, registration) => {
                  const id = await vm.create(title, summary, cover, registration)
                  // 만든 작품의 관리 화면으로 바꿔 보여 준다(뒤로 가기로 빈 생성 화면에 돌아오지 않게 replace).
                  if (id) navigate(`/content?work=${encodeURIComponent(id)}`, { replace: true })
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
                onForked={(id) => navigate(`/content?work=${encodeURIComponent(id)}`)}
                onDeleted={() => navigate('/lib?tab=write')}
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
      <Footer />
    </>
  )
}

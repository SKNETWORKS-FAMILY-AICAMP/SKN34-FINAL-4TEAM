import { Navigate, useParams, useSearchParams } from 'react-router'

import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useWorkWikiViewModel } from '../viewmodel/useWorkWikiViewModel'
import { PublicWikiArticle } from './PublicWiki'
import { UnavailableWork } from './WorkPage'

/**
 * U45 설정 위키(`/work/:id/wiki`): 작품 상세의 `설정 위키` 링크(최신 공개 회차 기준)와 회차 화면의 `설정` 링크(`?upto=n`, 그 회차 기준)로
 * 들어오는 읽기 전용 페이지. 작품에 연결된 세계관(DEC-46)이 있으면 그 세계관의 독자 공개 카드를, 없으면 기존 작품 설정을 보인다.
 * 메모리 데모 작품의 wiki는 서버 공개 범위로 걸러진 것이 아니므로 작품 상세로 돌려보낸다.
 */
export function PublicWikiPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const fromEpisode = params.has('upto')
  const vm = useWorkWikiViewModel(id, Number(params.get('upto')) || undefined)
  const w = vm.work
  useDocumentTitle(w ? `${w.title}/설정 위키` : '설정 위키')
  if (w === undefined) return <><Gnb /><main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry} /></main></>
  if (w === null) return <UnavailableWork />
  if (!w.canonical) return <Navigate replace to={`/work/${id}`} />
  return (
    <>
      <div className={`calm calm-${w.theme}`} style={{ minHeight: '100vh' }}>
        <main className="wrap" id="main" tabIndex={-1}>
          <div className="topbar">
            {fromEpisode
              ? <Go to={`/read/${id}/${vm.upto}`} className="back" aria-label={`${w.title} ${vm.upto}화로 돌아가기`}><BackChev />{vm.upto}화</Go>
              : <Go to={`/work/${id}`} className="back" aria-label={`${w.title} 소설 상세로 돌아가기`}><BackChev />{w.title}</Go>}
          </div>
          <PublicWikiArticle work={w} upto={vm.upto} relationsUnavailable={vm.relationsUnavailable} />
        </main>
      </div>
      <Footer />
    </>
  )
}

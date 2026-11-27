import { Navigate, useParams, useSearchParams } from 'react-router'

import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer } from '../../../shared/shell/Gnb'
import { ScreenTour, type TourStep } from '../../../shared/tour/ScreenTour'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useWorkWikiViewModel } from '../viewmodel/useWorkWikiViewModel'
import { PublicWikiArticle } from './PublicWiki'
import { UnavailableWork } from './WorkPage'


// 사용법 투어(#971): 설정 위키(탭 없음). 읽는 진도를 서버가 기억해 거르는 것이 아니라 주소의 ?upto=n(회차 화면의 \'설정\' 링크)이 정한 회차까지 공개된 설정이다. 대상이 없는 단계(공개된 설정 없음)는 빠진다.
const wikiTour: TourStep[] = [
  { target: 'wiki-scope', title: '공개된 설정만 보여요', text: '회차 화면의 \'설정\'에서 열면 그 회차까지 공개된 설정만 보여서 스포일러 없이 볼 수 있어요. 소설 상세의 \'설정 위키\'에서 열면 발행된 최신 회차까지 공개된 설정이 보여요.' },
  { target: 'wiki-toc', title: '목차', text: '분류와 문서 이름을 누르면 그 문서로 건너뛰어요.' },
  { target: 'wiki-docs', title: '문서', text: '분류별 문서가 펼쳐져 있어요. 문서 번호를 누르면 목차로 돌아가고, \'N화 공개\' 표시는 그 사실이 공개되는 회차예요.' },
  { target: 'wiki-back', title: '돌아가기', text: '위쪽 뒤로 가기로 읽던 회차(소설 상세에서 왔다면 소설 상세)로 돌아가요.' },
]

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
  if (w === undefined) return <main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry} /></main>
  if (w === null) return <UnavailableWork />
  if (!w.canonical) return <Navigate replace to={`/work/${id}`} />
  return (
    <>
      <div className={`calm calm-${w.theme}`}>
        <main className="wrap" id="main" tabIndex={-1}>
          <div className="topbar" data-tour="wiki-back">
            {fromEpisode
              ? <Go to={`/read/${id}/${vm.upto}`} className="back" aria-label={`${w.title} ${vm.upto}화로 돌아가기`}><BackChev /><span>{vm.upto}화</span></Go>
              : <Go to={`/work/${id}`} className="back" aria-label={`${w.title} 소설 상세로 돌아가기`}><BackChev /><span>{w.title}</span></Go>}
            <ScreenTour screen="wiki" steps={wikiTour} className="btn sm weak" />
          </div>
          <PublicWikiArticle work={w} upto={vm.upto} relationsUnavailable={vm.relationsUnavailable} />
        </main>
      </div>
      <Footer />
    </>
  )
}

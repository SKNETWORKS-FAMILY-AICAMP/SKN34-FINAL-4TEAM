import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { StoryPlanWorkspace } from './StoryPlanWorkspace'

export function StoryPlanPage({ id }: { id: string }) {
  useScreenId('U40')
  useDocumentTitle('플롯')
  return <div className="calm rd studio">
    <header className="sbar"><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><h1 className="t" style={{ fontSize: 'inherit' }}>집필실</h1><nav className="svw" aria-label="집필 도구"><Go to={`/studio/${id}`}>원고</Go><Go to={`/studio/${id}?view=narrative`} className="on" aria-current="page">플롯</Go></nav></header>
    <main id="main" tabIndex={-1} className="sview"><StoryPlanWorkspace workId={id} /></main>
  </div>
}

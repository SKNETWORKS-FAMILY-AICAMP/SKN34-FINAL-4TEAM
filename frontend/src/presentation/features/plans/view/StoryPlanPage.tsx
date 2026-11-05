import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { useScreenId } from '../../../shared/screenIds'
import { StoryPlanWorkspace } from './StoryPlanWorkspace'

export function StoryPlanPage({ id }: { id: string }) {
  useScreenId('U40')
  return <div className="calm rd studio">
    <header className="sbar"><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><span className="t">집필실</span><nav className="svw" aria-label="집필 도구"><Go to={`/studio/${id}`}>원고</Go><Go to={`/studio/${id}?view=narrative`} className="on" aria-current="page">플롯</Go></nav></header>
    <div className="sview"><StoryPlanWorkspace workId={id} /></div>
  </div>
}

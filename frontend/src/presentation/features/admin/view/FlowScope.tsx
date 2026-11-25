import { Link } from 'react-router'

import { PIPELINE_FLOWS, promptViewHref, type PipelineFlowKey, type PromptSub } from '../../../../domain/entities/admin'
import { flowPrompts } from '../../../../domain/entities/llmOpsScope'

/**
 * 흐름 범위 안내(#857): 사이드바 하위 탭에서 고른 흐름이 이 보기를 거르고 있음을 표 위에서 알리고, 전체 보기 링크로 같은 보기의 범위를 풉니다.
 * 전체(범위 없음)에서는 아무것도 그리지 않습니다.
 */
export function FlowScope({ sub, workflow }: { sub: PromptSub; workflow: PipelineFlowKey }) {
  const names = flowPrompts(workflow)
  if (!names) return null
  return (
    <p className="small muted pipe-scope">
      {PIPELINE_FLOWS.find(([key]) => key === workflow)?.[1]}의 프롬프트 {names.length}개 · <Link to={promptViewHref(sub, 'all')}>전체 보기</Link>
    </p>
  )
}

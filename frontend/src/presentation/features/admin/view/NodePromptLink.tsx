import { promptTargets, type PipelineNode } from '../../../../domain/entities/llmOpsPipeline'
import { promptLabel } from '../../../../domain/entities/promptNames'
import { PopMenu } from '../../../shared/PopMenu'
import type { LlmVM } from './LlmOps'

/**
 * 파이프라인 노드의 '프롬프트 보기'(#857): 그 노드가 쓰는 프롬프트의 상세(개선 루프)로 바로 갑니다. 대상은 기록 줄 메뉴와 같은 규칙(promptTargets)이고,
 * 하나면 버튼·여럿이면 목록 메뉴·없으면 아무것도 그리지 않습니다. 노드 버튼 목록·기록 패널 머리(서버 노드)·단계 설명 패널(구조용 단계)이 같은 부품을 쓰고, 캔버스 위에는 두지 않습니다.
 */
export function NodePromptLink({ l, node }: { l: Pick<LlmVM, 'openPrompt'>; node: Pick<PipelineNode, 'label' | 'promptNames'> }) {
  const prompts = promptTargets(node)
  if (!prompts.length) return null
  if (prompts.length === 1) {
    const [name] = prompts
    return <button type="button" className="pipe-prompt-link" aria-label={`프롬프트 보기 · ${node.label} · ${promptLabel(name)}`} onClick={() => l.openPrompt(name)}>프롬프트 보기</button>
  }
  return (
    <PopMenu className="row-menu pipe-prompt-menu" label={`프롬프트 보기 · ${node.label}`} icon={<span className="pipe-prompt-link">프롬프트 보기 ▾</span>}>
      {prompts.map((name) => <button key={name} type="button" role="menuitem" onClick={() => l.openPrompt(name)}>{promptLabel(name)}</button>)}
    </PopMenu>
  )
}

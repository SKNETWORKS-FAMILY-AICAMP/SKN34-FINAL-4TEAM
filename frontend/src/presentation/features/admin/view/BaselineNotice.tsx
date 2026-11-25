import { staleBaseline, type Prompt } from '../../../../domain/entities/llmOps'
import { kstDateTime } from '../../../shared/format'
import type { LlmVM } from './LlmOps'

/**
 * ③ 평가·⑤ 게이트의 안내(#868): 짝 평가 세트의 마지막 문항이 기준 Run(production 버전의 가장 최근 Run)과 같거나 늦게 만들어졌으면 그 점수는 마지막 문항을 보지 못한 것이라
 * 평가 서비스가 기준으로 쓰지 않고, 다음 평가가 production 버전을 먼저 다시 평가한다(비용 두 배). 근거로 두 시각을 함께 보입니다. 짝 세트가 없거나 시각을 모르면 아무것도 그리지 않습니다.
 */
export function BaselineNotice({ l, p }: { l: LlmVM; p: Prompt }) {
  const pair = l.dataset.pair, stale = pair && staleBaseline(p, pair.lastItemAt)
  if (!pair || !stale) return null
  return (
    <p className="admin-note">
      세트가 바뀌어 다음 평가에서 기준 버전을 먼저 다시 평가해요(비용 두 배).
      <span className="small muted"> 기준 Run 시작 {kstDateTime(stale.baselineAt)} · {pair.name}의 마지막 문항 {kstDateTime(stale.lastItemAt)}</span>
    </p>
  )
}

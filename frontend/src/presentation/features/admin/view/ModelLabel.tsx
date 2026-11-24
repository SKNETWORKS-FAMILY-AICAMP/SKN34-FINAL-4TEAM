import { modelLabel, type RecentModel } from '../../../../domain/entities/llmOps'
import { kstDateTime } from '../../../shared/format'

/** 근거 설명: 어느 버전의 파이프라인 기록에서 언제 쓰인 모델인지입니다. */
const modelBasis = (recent: RecentModel) => `${recent.version}번 버전의 파이프라인 기록${recent.at ? ` · ${kstDateTime(recent.at)}` : ''}`

/**
 * 모델 칸(#857): 고른 모델이 있으면 그 이름이고, 없으면 '기본 모델(환경 설정)'입니다. 파이프라인 기록에서 실제로 쓰인 모델을 찾았다면(recentDefaultModel)
 * '기본 모델 · 최근 사용 …'으로 보이고 근거(버전·시각)를 마우스를 올리면(basis를 보이면 글자로) 알립니다. 근거가 없으면 이름을 지어내지 않습니다.
 */
export function ModelLabel({ model, recent, basis = false }: { model: string | null | undefined; recent: RecentModel | null; basis?: boolean }) {
  const evidence = !model && recent ? modelBasis(recent) : null
  return <span title={evidence ?? undefined}>{modelLabel(model, recent)}{basis && evidence && <>{' '}<small className="model-basis">({evidence})</small></>}</span>
}

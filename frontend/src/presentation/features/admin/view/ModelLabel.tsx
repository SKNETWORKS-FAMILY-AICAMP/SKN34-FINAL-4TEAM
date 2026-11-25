import { modelLabel, type RecentModel } from '../../../../domain/entities/llmOps'
import { kstDateTime } from '../../../shared/format'

/** 근거 설명: 어느 버전의 파이프라인 기록에서 언제 쓰인 모델인지입니다. */
const modelBasis = (recent: RecentModel) => `${recent.version}번 버전의 파이프라인 기록${recent.at ? ` · ${kstDateTime(recent.at)}` : ''}`
/** 서버가 알려 준 실제 기본 모델(#868)의 출처 설명. */
const SERVED = 'AI 서비스가 실제로 쓰는 기본 모델'

/**
 * 모델 칸(#857·#868): 고른 모델이 있으면 그 이름이고, 없으면 서버가 알려 준 실제 기본 모델(effective, '기본 모델 · gpt-…')입니다.
 * 서버가 못 알려 줬을 때(effective가 비었을 때)만 파이프라인 기록에서 실제로 쓰인 모델을 찾은 '기본 모델 · 최근 사용 …'(recentDefaultModel)을 보이고, 둘 다 없으면 '기본 모델(환경 설정)'로 이름을 지어내지 않습니다.
 * 출처(서버 응답 또는 어느 버전의 기록·시각)는 마우스를 올리면(basis를 보이면 글자로) 알립니다.
 */
export function ModelLabel({ model, effective, recent, basis = false }: { model: string | null | undefined; effective?: string | null; recent: RecentModel | null; basis?: boolean }) {
  const source = model ? null : effective ? SERVED : recent ? modelBasis(recent) : null
  return <span title={source ?? undefined}>{modelLabel(model, recent, effective)}{basis && source && <>{' '}<small className="model-basis">({source})</small></>}</span>
}

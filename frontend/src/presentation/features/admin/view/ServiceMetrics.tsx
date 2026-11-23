import { baseEpisodeBars, funnelGroups, reactionsPerEpisode, reactionText, type Funnel } from '../../../../domain/entities/operationsFunnel'
import { BaseEpisodeChart, FunnelChart, ReactionsChart } from './AdminCharts'

/** 차트 위 비율 목록: 이름 · 비율 ±오차 · n(분모). 목록 이름으로 스크린리더가 한 묶음으로 읽고, 숫자는 자릿수가 달라도 정렬됩니다. */
function Rates({ label, rows }: { label: string; rows: { label: string; text: string }[] }) {
  return (
    <ul className="admin-funnel-rates" aria-label={label}>
      {rows.map((row) => <li key={row.label}><span>{row.label}</span><b>{row.text}</b></li>)}
    </ul>
  )
}

/**
 * 개요의 '서비스 지표(전체 기간)'(DEC-57): Content가 센 사용자 여정 퍼널. 단계 막대 4묶음과 회차당 반응, Fork 기준 회차 분포를 그리고,
 * 막대 위 목록에 비율 ±오차(95% 최악 기준 ±1/√n %p)와 n을 적습니다. Content를 읽지 못하면 funnel이 비어 와 0으로 채우지 않고 '불러오지 못함'으로 보입니다.
 */
export function ServiceMetrics({ funnel }: { funnel: Funnel | null | undefined }) {
  const reactions = funnel ? reactionsPerEpisode(funnel.reactions) : []
  return (
    <section className="panel admin-operations admin-funnel" aria-label="서비스 지표(전체 기간)">
      <h2>서비스 지표(전체 기간)</h2>
      {funnel
        ? (
          <div className="admin-charts">
            {funnelGroups(funnel).map((group) => (
              <div key={group.key} className="admin-funnel-group">
                <FunnelChart group={group} lead={<Rates label={`${group.title} 비율`} rows={group.rates} />} />
                {group.note && <p className="small muted">{group.note}</p>}
              </div>
            ))}
            <div className="admin-funnel-group">
              <ReactionsChart rows={reactions} lead={<Rates label="회차당 반응 값" rows={reactions.map((row) => ({ label: row.label, text: reactionText(row) }))} />} />
              <p className="small muted">발행 회차당 평균이에요. Fork가 물려받은 회차와 삭제·숨김 반응은 빼요.</p>
            </div>
            <div className="admin-funnel-group">
              <BaseEpisodeChart bars={baseEpisodeBars(funnel.forks)} />
            </div>
          </div>
        )
        : <p className="admin-empty"><b className="unavailable">불러오지 못함</b> Content 집계를 읽지 못했어요.</p>}
      <p className="admin-note">시연 데이터를 집계한 값이에요. ±는 95% 최악 기준 ±1/√n(%p), n은 비율의 분모예요.</p>
    </section>
  )
}

import { baseEpisodeBars, funnelGroups, reactionsPerEpisode, reactionText, type Funnel } from '../../../../domain/entities/operationsFunnel'
import { BaseEpisodeChart, FunnelChart, ReactionsChart } from './AdminCharts'

/**
 * 개요 맨 위 '서비스 지표(전체 기간)'(DEC-57): Content가 센 사용자 여정 퍼널. 단계 막대 4묶음과 회차당 반응, Fork 기준 회차 분포를 그리고,
 * 막대 아래 목록에 비율 ±오차(95% 최악 기준 ±1/√n %p)와 n을 적습니다. Content를 읽지 못하면 funnel이 비어 와 0으로 채우지 않고 '불러오지 못함'으로 보입니다.
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
                <FunnelChart group={group} />
                <ul className="admin-funnel-rates" aria-label={`${group.title} 비율`}>
                  {group.rates.map((rate) => <li key={rate.label}><span>{rate.label}</span><b>{rate.text}</b></li>)}
                </ul>
                {group.note && <p className="small muted">{group.note}</p>}
              </div>
            ))}
            <div className="admin-funnel-group">
              <ReactionsChart rows={reactions} />
              <ul className="admin-funnel-rates" aria-label="회차당 반응 값">
                {reactions.map((row) => <li key={row.label}><span>{row.label}</span><b>{reactionText(row)}</b></li>)}
              </ul>
              <p className="small muted">좋아요·관심·댓글 수 ÷ 각 작품이 직접 발행한 회차 수예요(Fork가 물려받은 원작 회차와 삭제·숨김 반응은 빼요).</p>
            </div>
            <div className="admin-funnel-group">
              <BaseEpisodeChart bars={baseEpisodeBars(funnel.forks)} />
              <p className="small muted">Fork가 갈라져 나온 기준 회차별 Fork 수예요.</p>
            </div>
          </div>
        )
        : <p className="admin-empty"><b className="unavailable">불러오지 못함</b> Content 집계를 읽지 못했어요. 0으로 채우지 않아요.</p>}
      <p className="admin-note">
        시연 데이터를 집계한 값이에요. ± 는 95% 최악 기준 ±1/√n(%p)이고 n은 비율의 분모예요. 수익(크레딧 사용·원작자 몫)과 사용성(SUS·과제 성공률)은 이 화면에 두지 않아요.
      </p>
    </section>
  )
}

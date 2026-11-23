import type { OrderIssue } from '../../../../domain/entities/worldReview'
import { groupOrderIssues } from '../viewmodel/orderGroups'

/** 경고 한 줄의 상세: 어느 글에 어떤 이름이 나오는지와 그 글이 독자에게 보이기 시작하는 회차. */
const where = (issue: OrderIssue, relationTitle: (relationId: string) => string) =>
  `${issue.source === 'body' ? '본문' : `관계 ‘${relationTitle(issue.relationId!)}’의 글`}에 ‘${issue.name}’이(가) 나와요 · 이 글은 ${issue.visibleFrom}화부터 독자에게 보여요`

/**
 * 편집 화면의 '공개 순서 확인'([계약](../../../../../../docs/design/world-review-contract.md#공개-순서-규칙--dec-53)): 이 카드의 글(본문·링크 글자, 이 카드를 끝점으로 하는 관계의 label·body)에
 * 이 글이 독자에게 보이기 시작하는 회차보다 늦게 공개되는 카드(작가 전용 포함)의 이름이 나오면 알린다. 경고일 뿐 저장·확정을 막지 않는다. 활동 막대의 공개 순서 탭이 이 절을 보인다.
 * 같은 카드의 이름이 본문·관계 글에 되풀이돼도 카드별 한 줄이다(`groupOrderIssues`): 이름(누르면 그 카드로 옮겨 간다) — N화부터 공개 · 본문 1 · 관계 글 5곳 (17·20화).
 * 줄의 '자세히'를 펼치면 어느 글에 어떤 이름이 나오는지 경고마다 보인다. 경고가 없으면 아무것도 그리지 않는다('공개 순서 문제 없음' 한 줄은 공개 범위 칸이 알린다).
 * 이름은 제목·별칭의 부분 문자열 일치라 짧은 이름은 잘못 잡힐 수 있다.
 */
export function WorldCardOrder({ issues, relationTitle, onOpenCard }: { issues: readonly OrderIssue[]; relationTitle: (relationId: string) => string; onOpenCard: (cardId: string) => void }) {
  if (!issues.length) return null
  return (
    <section className="world-findings" aria-label="공개 순서 확인">
      <h4>공개 순서 확인 <span className="small muted">이 글이 보일 때 아직 공개되지 않은 설정의 이름이 나와요 · 저장·확정을 막지 않아요</span></h4>
      <ul>
        {groupOrderIssues(issues).map((group) => (
          <li key={group.cardId} className="world-finding">
            <p>
              <button type="button" className="world-finding-link" onClick={() => onOpenCard(group.cardId)}>{group.title}</button>
              {' — ' + group.detail}
            </p>
            <details className="world-finding-more">
              <summary aria-label={group.title + ' 경고 자세히'}>자세히</summary>
              <ul>{group.issues.map((issue, i) => <li key={`${issue.source}:${issue.relationId ?? ''}:${i}`}>{where(issue, relationTitle)}</li>)}</ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

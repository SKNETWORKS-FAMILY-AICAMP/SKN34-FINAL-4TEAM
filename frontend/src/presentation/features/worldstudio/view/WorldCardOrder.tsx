import type { OrderIssue } from '../../../../domain/entities/worldReview'

/**
 * 편집 화면의 '공개 순서 확인'([계약](../../../../../../docs/design/world-review-contract.md#공개-순서-규칙--dec-53)): 이 카드의 글(본문·링크 글자, 이 카드를 끝점으로 하는 관계의 label·body)에
 * 이 글이 독자에게 보이기 시작하는 회차보다 늦게 공개되는 카드(작가 전용 포함)의 이름이 나오면 어느 글에 어떤 이름이 나오는지 알린다. 경고일 뿐 저장·확정을 막지 않는다.
 * 이름이 나온 카드로 옮겨 갈 수 있다. 경고가 없으면 이 절은 없다. 이름은 제목·별칭의 부분 문자열 일치라 짧은 이름은 잘못 잡힐 수 있다.
 */
export function WorldCardOrder({ issues, relationTitle, onOpenCard }: { issues: readonly OrderIssue[]; relationTitle: (relationId: string) => string; onOpenCard: (cardId: string) => void }) {
  if (!issues.length) return null
  return (
    <section className="world-findings" aria-label="공개 순서 확인">
      <h4>공개 순서 확인 <span className="small muted">이 글이 보일 때 아직 공개되지 않은 설정의 이름이 나와요 · 저장·확정을 막지 않아요</span></h4>
      <ul>
        {issues.map((issue, i) => (
          <li key={`${issue.source}:${issue.relationId ?? ''}:${issue.named.cardId}:${i}`} className="world-finding">
            <p>
              {issue.source === 'body' ? '본문' : `관계 ‘${relationTitle(issue.relationId!)}’의 글`}에 ‘{issue.name}’이(가) 나와요.{' '}
              <button type="button" className="world-finding-link" onClick={() => onOpenCard(issue.named.cardId)}>{issue.named.title || '이름 없는 설정'}</button>
              {` 카드는 ${issue.named.from === undefined ? '작가 전용' : `${issue.named.from}화부터 공개`}인데 이 글은 ${issue.visibleFrom}화부터 독자에게 보여요.`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

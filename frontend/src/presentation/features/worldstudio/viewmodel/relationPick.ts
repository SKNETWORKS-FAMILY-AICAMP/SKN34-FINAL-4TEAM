/** 관계 연결 단계 그래프에서 노드를 누를 때의 폼 상태: 주체, 상대를 고르는 중인지. */
type RelationPick = { source: string; choosing: boolean }
/** 눌린 뒤의 주체·대상 선택, 관계 작성 패널을 열지, 상대를 고르는 중인지. */
type RelationPickResult = { source: string; target: string; open: boolean; choosing: boolean }

/**
 * 노드를 차례로 두 번 누르면 관계 폼이 채워진다. 처음 누른 노드는 주체가 되어 상대를 고르는 중이 되고(기존 '관계 연결' 버튼과 같다),
 * 그다음 다른 노드는 대상이 되어 관계 작성을 연다(기존 '상대 선택' 버튼과 같다). 고르는 중에 주체를 다시 누르면 고르기를 멈춘다.
 */
export function pickRelationNode({ source, choosing }: RelationPick, id: string): RelationPickResult {
  if (!choosing) return { source: id, target: '', open: false, choosing: true }
  if (id === source) return { source, target: '', open: false, choosing: false }
  return { source, target: id, open: true, choosing: false }
}

import type Editor from '@toast-ui/editor'
import type { PluginContext } from '@toast-ui/editor'

/*
 * Toast UI Editor 3(마크다운 쓰기 모드)의 알려진 결함 세 가지를 막는 보정. 원고 편집기(집필실)와 카드 편집기(세계관 작업실)가 함께 쓴다.
 * 셋 다 "화면에 보이는 글"과 "편집기가 내는 글(getMarkdown·change)"이 어긋나거나 글이 사라지는 문제라, 그대로 두면 틀린 글이 저장된다.
 * ProseMirror 타입은 Toast의 플러그인 문맥에서 꺼내 쓴다(ProseMirror를 직접 의존성으로 두지 않는다).
 */
export type PMState = PluginContext['pmState']
type PluginSpec = ConstructorParameters<PMState['Plugin']>[0]
export type View = Parameters<NonNullable<PluginSpec['view']>>[0]
export type State = View['state']
export type Transaction = State['tr']

/**
 * Toast는 문단(줄) '안쪽' 위치의 단계만 자기 글(toastMark)로 바르게 옮긴다. 문단 사이 위치가 낀 단계는 줄바꿈 하나를 잃어,
 * 화면에는 맞게 보이는데 getMarkdown()과 change가 다른 글을 낸다(그대로 저장된다). 한 줄 전체(빈 줄 포함)를 고르고 빈 줄로 시작하는 글을 붙여넣을 때,
 * 줄 처음부터 다음 줄 처음까지 지운 것을 되돌릴 때 그런 단계가 생긴다.
 * 그런 트랜잭션은 결과 문서가 같은 '문서 전체 바꾸기' 한 단계로 바꿔 넘긴다(Toast의 setMarkdown과 같은 모양이라 통째로 다시 맞춘다).
 * 되돌리기·다시 하기가 그대로 이어지도록 트랜잭션에 실린 표시(meta)와 커서는 옮겨 싣는다.
 */
export function forToast(tr: Transaction, state: State, { Selection }: PMState) {
  const inLines = tr.steps.every((step, i) => {
    const { from, to, slice } = step as Partial<{ from: number; to: number; slice: unknown }>
    return !slice || from === undefined || to === undefined || (tr.docs[i].resolve(from).depth > 0 && tr.docs[i].resolve(to).depth > 0)
  })
  if (inLines) return tr
  const whole = state.tr.replaceWith(0, state.doc.content.size, tr.doc.content)
  const { meta } = tr as unknown as { meta: Record<string, unknown> }
  for (const key in meta) whole.setMeta(key, meta[key])
  return whole.setSelection(Selection.fromJSON(whole.doc, tr.selection.toJSON())).scrollIntoView()
}

/**
 * 처음 글을 넣는다. 새로 만든(글을 아직 넣지 않은) 편집기에 한 번만 쓴다.
 * - Toast의 구문 강조(appendTransaction)는 일부 글(예: 문서 끝의 들여쓴 ``` 줄)에서 범위를 잘못 계산해 예외를 던진다. 그대로 두면 그런 글은 편집기를 만들다 죽어 화면이 열리지 않고,
 *   입력 중이면 Toast의 글만 바뀐 채 문서는 그대로라 저장 글이 어긋난다. 강조는 꾸밈일 뿐이므로 실패하면 그 한 번의 강조만 건너뛴다. 그래서 글도 이 처리를 건 다음에 넣는다(생성자의 initialValue로 넣지 않는다).
 * - Toast는 처음 글을 넣는 것까지 되돌리기 기록에 남겨, 열자마자 Ctrl+Z를 누르면 글이 통째로 지워지고 change까지 나간다.
 *   같은 문서로 편집 상태를 새로 만들어 플러그인 상태(되돌리기 기록)를 비운다. EditorState는 Toast가 내주지 않아 지금 상태의 생성자에서 얻는다.
 * change 이벤트는 이 함수를 부른 뒤에 이어야 열기만 해서는 알리지 않는다.
 */
export function loadMarkdown(editor: Editor, view: View, markdown: string) {
  for (const plugin of view.state.plugins) {
    const mark = plugin.spec.appendTransaction
    if (mark) plugin.spec.appendTransaction = (...args) => { try { return mark.apply(plugin, args) } catch { return null } }
  }
  editor.setMarkdown(markdown, false)
  const EditorState = view.state.constructor as unknown as { create(config: Pick<State, 'doc' | 'plugins'>): State }
  view.updateState(EditorState.create({ doc: view.state.doc, plugins: view.state.plugins }))
}

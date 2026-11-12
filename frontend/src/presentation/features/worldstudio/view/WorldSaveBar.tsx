import { useId } from 'react'

import { writingIssueLabel } from '../../../../domain/entities/worldStudioWriting'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 관리 모드의 상시 저장 영역(설정집 화면의 탭 줄 오른쪽, 편집 화면의 상단 바). 바뀐 것이 있으면 '저장하지 않은 변경 있음'과 세계관 저장 버튼, 없으면 '저장됨'이다(한 번도 저장한 적 없는 세계관은 첫 저장을 할 수 있다).
 * 저장 전에 확인할 문제가 있으면 첫 사유와 건수를 버튼 옆에 보이고 저장을 막는다. 사유에는 어느 설정의 문제인지 이름이 붙고(`writingIssueLabel`), 누르면 그 설정의 편집 화면으로 간다:
 * 하나를 고치면 다음 사유가 첫 사유가 되므로 눌러서 차례로 고칠 수 있다. 저장 로직·검증·충돌 처리는 작성 모드와 같은 `vm.save`다. 화면을 옮겨도 입력은 그대로다.
 */
export function WorldSaveBar({ vm }: { vm: VM }) {
  const reason = useId()
  const first = vm.writingIssues[0]
  const text = vm.saveState === 'saving' ? '저장 중…'
    : vm.saveState === 'failed' ? '저장 실패 · 입력은 유지돼요'
    : vm.dirty ? '저장하지 않은 변경 있음'
    : vm.saved?.version === 0 ? '아직 저장하지 않았어요'
    : '저장됨'
  return (
    <div className="world-save-bar" role="group" aria-label="저장 상태">
      <span role="status" className={'world-save-state ' + (text === '저장됨' ? 'ok' : 'wait')}>{text}</span>
      {first && vm.editing && (
        <span id={reason} className="small world-save-issue">
          <button type="button" onClick={() => vm.openIssue(first)}>{writingIssueLabel(vm.editing, first)}</button>
          {vm.writingIssues.length > 1 && ` 외 ${vm.writingIssues.length - 1}건`}
        </span>
      )}
      <button type="button" className="btn pri sm" disabled={!vm.canSave} aria-describedby={first ? reason : undefined} onClick={vm.save}>세계관 저장</button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { isPub, type Work } from '../../../../domain/entities/work'
import { canManageNotices, type WorkNotice, type WorkNoticeInput } from '../../../../domain/entities/workNotice'
import type { WorkNoticeUseCase } from '../../../../domain/usecases/WorkNoticeUseCase'
import { toast } from '../../../shared/events'
import { useAsyncData } from '../../../shared/useAsyncData'

/**
 * 소설 상세의 소식 탭. 실제 작품(canonical)은 Content 작품 소식 API([계약](../../../../../../docs/design/work-notice-contract.md))를,
 * 메모리 데모 작품은 같은 계약의 메모리 저장소를 UseCase로 받습니다. 작품이 바뀌면 호출 측이 key로 새로 만들어 입력과 요청 상태를 비웁니다.
 * 쓰기는 한 번에 하나만 보내며(busy), 성공하면 이전 목록을 유지한 채 서버 값으로 다시 읽습니다. 입력 검증은 UseCase가 하고,
 * 입력 거절·서버 거절·실패는 안내만 하며 곧바로 잠금을 풀어 다시 보낼 수 있고 입력은 호출 측이 그대로 둡니다. 화면을 떠나면 읽기와 쓰기 요청을 함께 취소합니다.
 */
export function useWorkNoticesViewModel(work: Work, useCase: WorkNoticeUseCase = appContainer.resolve(work.canonical ? 'workNoticeUseCase' : 'demoWorkNoticeUseCase')) {
  const role = useAppSelector((s) => s.session.role)
  const memberId = useAppSelector((s) => s.session.memberId)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  // StrictMode의 가짜 언마운트 뒤에도 새 신호를 쓰도록 effect 안에서 만듭니다.
  const leaving = useRef<AbortController>(null)
  useEffect(() => {
    const controller = new AbortController()
    leaving.current = controller
    return () => controller.abort()
  }, [])
  // 서버는 공개 작품만 목록을 주므로(공개 전·운영 제한은 404) 서버 작품이 공개 전이면 요청하지 않고 안내만 합니다.
  const open = !work.canonical || isPub(work)
  const { data, isError, retry } = useAsyncData((signal) => (open ? useCase.list(work.id, signal) : Promise.resolve(undefined)), [useCase, work.id, open])

  /** 성공하면 true. 보내는 중이면 무시하고, 입력 거절(UseCase 검증)·서버 거절·네트워크 실패는 안내만 하며 finally가 잠금을 풉니다. */
  const send = async (task: (signal?: AbortSignal) => Promise<unknown>, done: string) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    try {
      await task(leaving.current?.signal)
      retry() // 같은 범위에서 이전 목록을 유지한 채 서버 값으로 다시 읽습니다.
      toast(done)
      return true
    } catch (error) {
      if (!leaving.current?.signal.aborted) toast(error instanceof Error && error.message ? error.message : '소식을 처리하지 못했어요.')
      return false
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return {
    /** undefined: 불러오는 중이거나 첫 조회 실패(isError) */
    notices: data,
    isError, retry,
    /** false: 서버 작품이 공개 전이라 소식을 읽을 수 없음(요청하지 않음) */
    open,
    /** 작성·수정·고정·삭제 버튼 표시. 권한은 서버가 다시 확인합니다. */
    canWrite: open && canManageNotices(work, role, memberId),
    busy,
    create: (input: WorkNoticeInput) => send((signal) => useCase.create(work.id, input, signal), '소식을 등록했어요'),
    update: (notice: WorkNotice, input: WorkNoticeInput) => send((signal) => useCase.update(notice, input, signal), '소식을 고쳤어요'),
    togglePin: (notice: WorkNotice) => send((signal) => useCase.togglePin(notice, signal), notice.pinned ? '상단 고정을 풀었어요' : '상단에 고정했어요'),
    remove: async (notice: WorkNotice) => window.confirm('이 소식을 삭제할까요?') && send((signal) => useCase.remove(notice, signal), '소식을 삭제했어요'),
  }
}

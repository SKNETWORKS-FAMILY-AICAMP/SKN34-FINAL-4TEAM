import { useMemo, useRef, useState } from 'react'

import { isJsonlFile, parseDatasetJsonl } from '../../../../domain/entities/llmDatasets'
import type { LlmDatasetUseCase } from '../../../../domain/usecases/LlmDatasetUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

type Picked = { fileName: string; text: string }

/**
 * 프롬프트 상세 ② 평가 세트의 데이터셋(#857, 서버 API 예정): 목록·고른 세트의 문항·JSONL 업로드 폼.
 * UseCase가 null이면(실제 모드: 서버 API가 아직 없다) ready가 false라 화면이 '서버 준비 중'으로 잠그고 아무것도 읽거나 보내지 않습니다(성공을 흉내 내지 않음).
 * 업로드 전 미리보기는 파일을 읽은 즉시 순수 규칙(parseDatasetJsonl)으로 검사하고, 올릴 때 UseCase가 같은 검사와 확인란을 다시 확인합니다.
 */
export function useDatasetViewModel(mutate: AdminMutate, active: boolean, useCase: LlmDatasetUseCase | null) {
  const [selected, setSelected] = useState<string | null>(null)
  const [setName, setSetName] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  // 올리기가 끝나면 올 때까지 남아 있는 파일 선택 표시를 지우려고 입력 칸을 새로 만드는 열쇠(고른 직후에는 바꾸지 않는다).
  const [inputKey, setInputKey] = useState(0)
  // 파일을 연달아 고르면 마지막 선택의 읽기 결과만 반영한다(먼저 고른 파일이 늦게 읽히며 덮어쓰거나 오류를 남기지 않게 선택마다 번호를 매긴다).
  const pickSeq = useRef(0)
  const datasets = useAsyncData(async () => (active && useCase ? useCase.datasets() : null), [useCase, active])
  const items = useAsyncData(async () => (active && useCase && selected ? useCase.items(selected) : null), [useCase, active, selected])
  const preview = useMemo(() => (picked ? parseDatasetJsonl(picked.text) : null), [picked])
  const canSubmit = !!useCase && !!picked && !!preview && preview.errors.length === 0 && preview.items.length > 0 && setName.trim() !== '' && confirmed

  return {
    ready: useCase !== null,
    datasets, selected, select: setSelected, items,
    form: {
      setName, setSetName, picked, pickError, preview, confirmed, setConfirmed, canSubmit, inputKey,
      pick: async (file: File | undefined) => {
        const seq = ++pickSeq.current
        setPicked(null)
        setPickError(null)
        if (!file) return
        if (!isJsonlFile(file.name)) return setPickError('.jsonl 파일만 올릴 수 있어요.')
        try {
          const text = await file.text()
          if (seq !== pickSeq.current) return
          setPicked({ fileName: file.name, text })
          setSetName((now) => now || file.name.replace(/\.jsonl$/i, ''))
        } catch {
          if (seq === pickSeq.current) setPickError('파일을 읽지 못했어요. 다시 골라 주세요.')
        }
      },
      submit: async () => {
        if (!useCase || !picked || !canSubmit) return
        const name = setName.trim()
        const ok = await mutate('dataset:upload', `${preview?.items.length ?? 0}개 문항을 '${name}' 세트에 올렸어요(시연용 메모리).`, () => useCase.upload(name, picked.fileName, picked.text, confirmed))
        if (ok) { setPicked(null); setConfirmed(false); setSetName(''); setInputKey((key) => key + 1); setSelected(name) }
      },
    },
  }
}

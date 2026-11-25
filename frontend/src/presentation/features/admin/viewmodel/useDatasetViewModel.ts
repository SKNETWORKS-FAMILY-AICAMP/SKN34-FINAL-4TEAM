import { useMemo, useRef, useState } from 'react'

import { DatasetInvalid, datasetLimitError, isJsonlFile, parseDatasetJsonl, type DatasetError } from '../../../../domain/entities/llmDatasets'
import type { LlmDatasetUseCase } from '../../../../domain/usecases/LlmDatasetUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

type Picked = { fileName: string; text: string; size: number }

/**
 * 프롬프트 상세 ② 평가 세트의 데이터셋(#868, 운영 서버 API): 목록·고른 세트의 문항(20개씩 쪽)·JSONL 업로드 폼.
 * 올릴 세트는 목록의 세트 중 하나(새 세트 만들기는 범위 밖)이고 처음에는 그 프롬프트의 짝 세트(preferred), 없으면 목록의 첫 세트입니다.
 * 업로드 전 미리보기는 파일을 읽은 즉시 순수 규칙(parseDatasetJsonl·datasetLimitError)으로 검사하고, 올릴 때 UseCase가 같은 검사와 확인란을 다시 확인한 뒤 서버가 한 번 더 검사합니다.
 * 서버가 줄을 거절하면(DatasetInvalid) 그 줄 목록을 거절 표시로 남기고(아무것도 올라가지 않음) 입력은 유지합니다.
 */
export function useDatasetViewModel(mutate: AdminMutate, active: boolean, useCase: LlmDatasetUseCase, preferred?: string) {
  const [selected, setSelected] = useState<string | null>(null)
  const [itemsPage, setItemsPage] = useState(0)
  const [chosen, setChosen] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [rejected, setRejected] = useState<DatasetError[]>([])
  // 올리기가 끝나면 올 때까지 남아 있는 파일 선택 표시를 지우려고 입력 칸을 새로 만드는 열쇠(고른 직후에는 바꾸지 않는다).
  const [inputKey, setInputKey] = useState(0)
  // 파일을 연달아 고르면 마지막 선택의 읽기 결과만 반영한다(먼저 고른 파일이 늦게 읽히며 덮어쓰거나 오류를 남기지 않게 선택마다 번호를 매긴다).
  const pickSeq = useRef(0)
  const datasets = useAsyncData(async () => (active ? useCase.datasets() : null), [useCase, active])
  const items = useAsyncData(async () => (active && selected ? useCase.items(selected, itemsPage) : null), [useCase, active, selected, itemsPage])
  const target = chosen || preferred || datasets.data?.[0]?.name || ''
  const preview = useMemo(() => {
    if (!picked) return null
    const parsed = parseDatasetJsonl(picked.text)
    return { ...parsed, limit: datasetLimitError(parsed.total, picked.size) }
  }, [picked])
  const canSubmit = !!picked && !!preview && preview.errors.length === 0 && preview.lines.length > 0 && !preview.limit && target !== '' && confirmed

  return {
    datasets, selected, select: (name: string | null) => { setSelected(name); setItemsPage(0) }, items, itemsPage, setItemsPage,
    form: {
      target, setTarget: setChosen, picked, pickError, preview, rejected, confirmed, setConfirmed, canSubmit, inputKey,
      pick: async (file: File | undefined) => {
        const seq = ++pickSeq.current
        setPicked(null)
        setPickError(null)
        setRejected([])
        if (!file) return
        if (!isJsonlFile(file.name)) return setPickError('.jsonl 파일만 올릴 수 있어요.')
        try {
          const text = await file.text()
          if (seq === pickSeq.current) setPicked({ fileName: file.name, text, size: file.size })
        } catch {
          if (seq === pickSeq.current) setPickError('파일을 읽지 못했어요. 다시 골라 주세요.')
        }
      },
      submit: async () => {
        if (!picked || !canSubmit) return
        const name = target
        let created = 0
        setRejected([])
        const ok = await mutate('dataset:upload', () => `${created}개 문항을 '${name}' 세트에 올렸어요.`, async () => {
          try { created = await useCase.upload(name, picked.fileName, picked.text, confirmed) } catch (error) {
            if (error instanceof DatasetInvalid) setRejected(error.errors)
            throw error
          }
        })
        if (ok) { setPicked(null); setConfirmed(false); setInputKey((key) => key + 1); setSelected(name); setItemsPage(0) }
      },
    },
  }
}

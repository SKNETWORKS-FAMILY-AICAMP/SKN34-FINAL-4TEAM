import { useEffect, useRef, useState } from 'react'
import { appContainer } from '../../../app/appContainer'
import type { ManuscriptQaAnswer, StoryQaTarget } from '../../../domain/entities/content'

export function useStoryQaViewModel(workId: string, episode: number, versionId: string, owner: boolean) {
  const [question, setQuestion] = useState('')
  const [target, setTarget] = useState<StoryQaTarget>('manuscript')
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [answer, setAnswer] = useState<ManuscriptQaAnswer>()
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [workId, episode, versionId, owner])

  function chooseTarget(value: string) {
    if (value !== 'manuscript' && value !== 'setting' && !(owner && value === 'relationship')) return
    setTarget(value)
    setAnswer(undefined)
    setError('')
    setConsent(false)
  }

  async function submit() {
    if (!consent || !question.trim() || active.current) return
    const request = new AbortController()
    active.current = request
    setPending(true)
    setError('')
    setAnswer(undefined)
    try {
      const result = await appContainer.resolve('episodeUseCase')
        .askStoryContext(workId, { episode, episodeVersionId: versionId, question: question.trim(), consent, target }, owner, request.signal)
      if (active.current === request) setAnswer(result)
    } catch (failure) {
      if (active.current === request) setError(failure instanceof Error ? failure.message : '답변을 가져오지 못했어요.')
    } finally {
      if (active.current === request) { active.current = null; setPending(false) }
    }
  }
  return { target, chooseTarget, question, setQuestion, consent, setConsent, pending, answer, error, submit }
}

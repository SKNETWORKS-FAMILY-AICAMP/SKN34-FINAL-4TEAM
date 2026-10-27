import { appContainer } from '../../../app/appContainer'
import { useCoreApiHealth } from './useCoreApiHealth'
import {
  coreApiStatusDotClassName,
  coreApiStatusStyles,
} from './CoreApiConnectionStatus.styles'

export function CoreApiConnectionStatus({ target = 'core-api' }: { target?: 'core-api' | 'ai-service' }) {
  const name = target === 'core-api' ? 'Core API' : 'AI Service (Core 경유)'
  const fetchHealth = appContainer.resolve(target === 'core-api' ? 'fetchCoreApiHealth' : 'fetchAiServiceHealth')
  const { data, isError, isLoading, refetch } = useCoreApiHealth(fetchHealth)
  const healthy = !isError && data?.status === 'up'

  return (
    <div className={coreApiStatusStyles.root}>
      <span aria-hidden="true" className={coreApiStatusDotClassName(isLoading ? 'loading' : healthy ? 'healthy' : 'error')} />
      <div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong className={coreApiStatusStyles.title}>
            {name} {isLoading ? '연결 확인 중' : healthy ? '연결됨' : '연결 실패'}
          </strong>
          <p className={coreApiStatusStyles.description}>
            {isLoading ? '서버 응답을 기다리고 있습니다.' : healthy
              ? `${data?.service} · 상태: ${data?.status}`
              : '서버 실행 상태와 연결 설정을 확인한 뒤 다시 시도하세요.'}
          </p>
        </div>
        <button
          type="button"
          disabled={isLoading}
          aria-label={`${name} 다시 확인`}
          className={coreApiStatusStyles.retryButton}
          onClick={() => void refetch()}
        >
          다시 확인
        </button>
      </div>
    </div>
  )
}

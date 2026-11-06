import { asValue } from 'awilix/browser'

import { fetchAiServiceHealth, fetchCoreApiHealth } from '../../data/api/fetchCoreApiHealth'
import { openNotificationStream } from '../../data/api/notificationStream'
import type { AppContainer } from './types'

/** UseCase가 아닌 외부 API 기능을 애플리케이션 컨테이너에 등록합니다. */
export function registerExternalServices(container: AppContainer) {
  container.register({
    openNotificationStream: asValue(openNotificationStream),
    fetchCoreApiHealth: asValue(fetchCoreApiHealth),
    fetchAiServiceHealth: asValue(fetchAiServiceHealth),
  })
}

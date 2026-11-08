import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'

import './scrollToSpy'
import { stubWorkSearch } from './stubWorkSearch'
import App from '../App'
import { createAppStore } from '../app/store'

/** 앱 전체를 격리된 Store와 메모리 라우터로 렌더링합니다. 홈 순위·검색은 서버 대신 메모리 시드로 답합니다. */
export function renderApp(path = '/', store = createAppStore()) {
  stubWorkSearch()
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]} useTransitions={false}><App /></MemoryRouter></Provider>) }
}

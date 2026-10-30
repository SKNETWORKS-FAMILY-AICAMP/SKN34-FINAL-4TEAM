import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'

import App from '../App'
import { createAppStore } from '../app/store'

/** 앱 전체를 격리된 Store와 메모리 라우터로 렌더링합니다. */
export function renderApp(path = '/', store = createAppStore()) {
  return { store, ...render(<Provider store={store}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>) }
}

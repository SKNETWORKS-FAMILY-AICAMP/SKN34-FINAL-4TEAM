import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { WorldStudioLeaveProvider } from './presentation/features/worldstudio/viewmodel/WorldStudioLeaveProvider'

import './index.css'
import App from './App.tsx'
import { createAppStore } from './app/store'

const router = createBrowserRouter([{path:'*',element:<WorldStudioLeaveProvider><App /></WorldStudioLeaveProvider>}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={createAppStore()}>
      {/* 목업 nav()처럼 상태 변경과 이동을 한 번에 렌더합니다. 그러지 않으면 로그아웃 직후 보호 화면이 /login으로 보냅니다. */}
      <RouterProvider router={router} useTransitions={false} />
    </Provider>
  </StrictMode>,
)

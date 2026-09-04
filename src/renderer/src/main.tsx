import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'

async function boot(): Promise<void> {
  // 浏览器预览兜底:Electron 里 window.api 由 preload 注入;纯浏览器打开时装假数据以便预览 UI。
  if (!(window as unknown as { api?: unknown }).api) {
    const { installMockApi } = await import('./mockApi')
    installMockApi()
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
void boot()

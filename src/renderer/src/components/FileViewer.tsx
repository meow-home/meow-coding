import { useEffect } from 'react'
import PopupTitleBar from './PopupTitleBar'
import FileContentView from './file-content/FileContentView'

interface Props {
  path: string
  root: string
}

export default function FileViewer({ path, root }: Props) {
  // Close via Escape; the native title bar provides minimize/maximize/close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="viewer">
      <PopupTitleBar title={path} />
      <FileContentView path={path} root={root} />
    </div>
  )
}

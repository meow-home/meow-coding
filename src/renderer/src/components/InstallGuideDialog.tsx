import { useEffect, useState } from 'react'
import type { BrowserInstallGuideEvent } from '@shared/ipc'
import BaseModal from './common/BaseModal'

interface Props {
  guide: BrowserInstallGuideEvent | null
  onClose: () => void
}

export default function InstallGuideDialog({ guide, onClose }: Props) {
  const [extensionDir, setExtensionDir] = useState<string | null>(guide?.extensionDir ?? null)

  useEffect(() => {
    if (guide) setExtensionDir(guide.extensionDir)
  }, [guide])

  const actionsNode = (
    <>
      <button className="btn" onClick={() => void window.api.openBrowserChromeExtensions()}>Open chrome://extensions</button>
      <button className="btn" onClick={() => void window.api.openBrowserExtensionFolder()}>Extension Folder</button>
    </>
  )

  return (
    <BaseModal
      title="Install Meow Browser Bridge"
      onClose={onClose}
      actions={actionsNode}
      size="lg"
      className="browser-dialog"
    >
      <ol className="browser-guide">
        <li>Click <strong>Open chrome://extensions</strong> — Chrome opens the extensions page.</li>
        <li>Enable <strong>Developer mode</strong> (top-right corner).</li>
        <li>Click <strong>Load unpacked</strong> and select the folder:
          <code className="browser-guide-dir">{extensionDir}</code>
        </li>
        <li>Back in Meow, open the Browser dialog and click <strong>Pair With Code</strong>, then enter the code in the extension popup.</li>
      </ol>
      <p className="browser-hint">
        The extension only connects to Meow on this machine (127.0.0.1) and requires a pairing code.
      </p>
    </BaseModal>
  )
}

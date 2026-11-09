import type { BrowserTabControl } from '@shared/browser-types'

interface Props {
  control: BrowserTabControl
  holdReason?: string
  onTakeOver: () => void
  onHandBack: () => void
}

export default function BrowserControlBanner({ control, holdReason, onTakeOver, onHandBack }: Props) {
  if (control === 'idle') return null

  if (control === 'approval') {
    return (
      <div className="browser-banner approval" role="status">
        <span className="browser-banner-text">Meow is waiting for your approval in chat.</span>
      </div>
    )
  }

  if (control === 'user') {
    return (
      <div className="browser-banner user" role="status">
        <span className="browser-banner-text">
          {holdReason ?? 'You have control. Meow is paused on this tab.'}
        </span>
        <button className="btn small" onClick={onHandBack}>
          {holdReason ? "I'm signed in" : 'Hand back'}
        </button>
      </div>
    )
  }

  return (
    <div className="browser-banner agent" role="status">
      <span className="browser-banner-text">Meow is using this tab</span>
      <button className="btn small" onClick={onTakeOver}>Take over</button>
    </div>
  )
}

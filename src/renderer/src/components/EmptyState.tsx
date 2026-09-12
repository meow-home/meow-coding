interface Props {
  hasWorkspace: boolean
}

export default function EmptyState({ hasWorkspace }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-mark">&gt;_</div>
      {hasWorkspace
        ? <p className="subtitle">A workspace is open but has no sessions yet. Use "+" in the sidebar to add one.</p>
        : <p className="subtitle">Select a project in the sidebar, or add a new project to get started.</p>}
    </div>
  )
}

import { useMemo } from 'react'
import { parseUnifiedDiff, type DiffLine } from './parseDiff'

interface Props {
  raw: string
}

function LineNumbers({ line }: { line: DiffLine }) {
  return (
    <span className="git-diff-num" aria-hidden="true">
      <span className="old-num">{line.oldLine ?? ''}</span>
      <span className="new-num">{line.newLine ?? ''}</span>
    </span>
  )
}

export default function GitDiffView({ raw }: Props) {
  const hunks = useMemo(() => parseUnifiedDiff(raw), [raw])

  if (hunks.length === 0) {
    return (
      <div className="git-diff-empty">
        <div className="git-diff-empty-title">No changes to display</div>
        <p className="git-diff-empty-sub">The file content matches between the compared states.</p>
      </div>
    )
  }

  return (
    <div className="git-diff-view">
      {hunks.map((hunk, hi) => (
        <div className="git-hunk" key={hi}>
          <div className="git-hunk-header">
            <span className="git-hunk-tag">@@</span>
            <span className="git-hunk-title">{hunk.header.replace(/^@@.*@@\s*/, '') || hunk.header}</span>
          </div>
          <div className="git-hunk-body">
            {hunk.lines.map((line, li) => (
              <div key={li} className={`git-diff-line ${line.type}`}>
                <LineNumbers line={line} />
                <span className="git-diff-sign" aria-hidden="true">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'meta' ? '\\' : ' '}
                </span>
                <span className="git-diff-text">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

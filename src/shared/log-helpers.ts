export function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

export function formatLogArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  return typeof a === 'string' ? a : safeJson(a)
}

// Formats console.* arguments the way a browser would: when the first argument
// is a printf-style format string ("%s %d %o"), interpolate the remaining
// arguments into it; otherwise join every argument with spaces. This matters
// for logging — React (and devtool libraries) log via console.error('%s\n\n%s',
// message, stack); without substitution the log line keeps literal "%s"
// placeholders and the real error text is lost.
export function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return ''
  const [first, ...rest] = args
  if (typeof first === 'string' && rest.length > 0 && /%[sdifoOc]/.test(first)) {
    let out = ''
    let consumed = 0
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== '%' || i + 1 >= first.length) {
        out += first[i]
        continue
      }
      const spec = first[i + 1]
      if (spec === '%') { out += '%'; i++; continue }
      const value = rest[consumed]
      // %s with an Error shows its stack in a real console; mirror that so a
      // logged exception carries the trace into the system log.
      if (spec === 's') out += value instanceof Error ? formatLogArg(value) : String(value)
      else if (spec === 'd' || spec === 'i') out += typeof value === 'number' ? String(Math.trunc(value)) : formatLogArg(value)
      else if (spec === 'f') out += typeof value === 'number' ? String(value) : formatLogArg(value)
      else if (spec === 'o' || spec === 'O') out += formatLogArg(value)
      else if (spec === 'c') out += '' // %c (CSS styling) renders as nothing in a text log
      consumed++
      i++
    }
    for (let i = consumed; i < rest.length; i++) out += ' ' + formatLogArg(rest[i])
    return out
  }
  return args.map(formatLogArg).join(' ')
}

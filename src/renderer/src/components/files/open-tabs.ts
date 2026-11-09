// Tab rules for the Files panel, as pure state transitions. The overlay keeps
// `{ tabs, activeTab }` in one state value so every action returns a valid state.

export interface OpenTab {
  path: string
  name: string
  /** Opened by a single click: the next preview replaces it. */
  preview: boolean
  /** A pinned tab is permanent and sorts before the unpinned ones. */
  pinned: boolean
}

export interface OpenTabsState {
  tabs: OpenTab[]
  activeTab: string | null
}

export interface OpenTabInput {
  path: string
  name: string
  /** True for a double click in the tree: open permanent, promote a preview. */
  permanent?: boolean
}

export const EMPTY_OPEN_TABS: OpenTabsState = { tabs: [], activeTab: null }

// Pinned tabs first, everything else in its current order.
function pinnedFirst(tabs: OpenTab[]): OpenTab[] {
  return [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)]
}

export function openTab(state: OpenTabsState, input: OpenTabInput): OpenTabsState {
  const { path, name, permanent = false } = input
  const existing = state.tabs.find(tab => tab.path === path)
  if (existing) {
    // An open file only activates — except that a permanent open promotes it.
    const tabs = existing.preview && permanent
      ? state.tabs.map(tab => (tab.path === path ? { ...tab, preview: false } : tab))
      : state.tabs
    return { tabs, activeTab: path }
  }

  const tab: OpenTab = { path, name, preview: !permanent, pinned: false }
  const previewIndex = permanent ? -1 : state.tabs.findIndex(candidate => candidate.preview && !candidate.pinned)
  // A single click replaces the preview tab in place; a permanent open appends.
  const tabs = previewIndex >= 0
    ? state.tabs.map((candidate, index) => (index === previewIndex ? tab : candidate))
    : pinnedFirst([...state.tabs, tab])
  return { tabs, activeTab: path }
}

export function activateTab(state: OpenTabsState, path: string): OpenTabsState {
  return state.tabs.some(tab => tab.path === path) ? { ...state, activeTab: path } : state
}

/** Double click on a tab, or the file becoming dirty: it stays for good. */
export function promoteTab(state: OpenTabsState, path: string): OpenTabsState {
  if (!state.tabs.some(tab => tab.path === path && tab.preview)) return state
  return { ...state, tabs: state.tabs.map(tab => (tab.path === path ? { ...tab, preview: false } : tab)) }
}

export function togglePinned(state: OpenTabsState, path: string): OpenTabsState {
  if (!state.tabs.some(tab => tab.path === path)) return state
  return {
    ...state,
    tabs: pinnedFirst(state.tabs.map(tab => (
      tab.path === path ? { ...tab, pinned: !tab.pinned, preview: false } : tab
    )))
  }
}

export function closeTabs(state: OpenTabsState, paths: string[]): OpenTabsState {
  const removed = new Set(paths)
  if (!state.tabs.some(tab => removed.has(tab.path))) return state
  const tabs = state.tabs.filter(tab => !removed.has(tab.path))
  const activeTab = state.activeTab && removed.has(state.activeTab)
    ? (tabs[tabs.length - 1]?.path ?? null)
    : state.activeTab
  return { tabs, activeTab }
}

/** "Close all tabs" keeps pinned tabs, which are permanent by definition. */
export function closeAllTabs(state: OpenTabsState): OpenTabsState {
  return closeTabs(state, state.tabs.filter(tab => !tab.pinned).map(tab => tab.path))
}

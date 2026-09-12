import { createContext, useContext } from 'react'

// App-level actions that deeply-nested UI (e.g. the composer's "+" menu) needs
// to invoke without prop-drilling through the pane tree. Provided by App.
export interface AppActions {
  /** Opens the "Add project" dialog to add a folder as a new project. */
  addFolder: () => void
}

export const AppActionsContext = createContext<AppActions>({ addFolder: () => {} })

export const useAppActions = (): AppActions => useContext(AppActionsContext)

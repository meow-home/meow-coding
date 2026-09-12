import { useState } from 'react'
import { Plus, ImagePlus, FolderPlus } from 'lucide-react'
import Dropdown from './Dropdown'
import { useAppActions } from '../../app-actions'

interface AddMenuProps {
  onAddFiles: () => void
}

// "+" dropdown next to the mode picker. Composer actions live here — attaching
// images, and adding a folder as a project (same flow as the sidebar's
// "Add Project", reached via the app-level action context).
export default function AddMenu({ onAddFiles }: AddMenuProps) {
  const [open, setOpen] = useState(false)
  const { addFolder } = useAppActions()

  return (
    <div className="add-dropdown">
      <Dropdown
        open={open}
        onToggle={() => setOpen(v => !v)}
        onClose={() => setOpen(false)}
        title="Add"
        ariaLabel="Add"
        menuClassName="add-menu"
        align="left"
        trigger={<Plus size={16} aria-hidden="true" />}
      >
        <div className="add-list">
          <button
            className="menu-item"
            onClick={() => { onAddFiles(); setOpen(false) }}
          >
            <ImagePlus size={16} aria-hidden="true" />
            <span className="menu-item-label">Add files or photos</span>
          </button>
          <button
            className="menu-item"
            onClick={() => { addFolder(); setOpen(false) }}
          >
            <FolderPlus size={16} aria-hidden="true" />
            <span className="menu-item-label">Add Folder</span>
          </button>
        </div>
      </Dropdown>
    </div>
  )
}

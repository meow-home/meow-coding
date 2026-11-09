import { useState } from 'react'
import { Plus, ImagePlus } from 'lucide-react'
import Dropdown from './Dropdown'

interface AddMenuProps {
  onAddFiles: () => void
}

// "+" dropdown next to the mode picker. Composer actions live here — attaching
// images. Adding a folder as a project moved to the new session's footer picker.
export default function AddMenu({ onAddFiles }: AddMenuProps) {
  const [open, setOpen] = useState(false)

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
        </div>
      </Dropdown>
    </div>
  )
}

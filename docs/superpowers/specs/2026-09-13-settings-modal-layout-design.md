# Settings Modal Layout Design Spec

## Overview
This specification covers layout and styling adjustments for `SettingsDialog`:
1. Using `<BaseModal.Header>` and `<BaseModal.Body noPadding>` compound components in `SettingsDialog.tsx` so the dialog body extends full width without outer left/right padding.
2. Updating `.settings-sidebar` background in `styles.css` from `var(--bg-panel)` to `var(--bg-chat)` to seamlessly match the modal background.

---

## Component Changes

### `src/renderer/src/components/settings/SettingsDialog.tsx`
Refactor root structure to use Compound Components:
```tsx
<BaseModal
  size="xl"
  onClose={onClose}
  className="settings-modal-dialog"
>
  <BaseModal.Header title="Settings" onClose={onClose} />
  <BaseModal.Body noPadding>
    <div className="settings-body">
      <aside className="settings-sidebar">
        ...
      </aside>
      <div className="settings-content">
        ...
      </div>
    </div>
  </BaseModal.Body>
</BaseModal>
```

---

## Styling Changes

### `src/renderer/src/styles.css`
Update `.settings-sidebar`:
```css
.settings-sidebar {
  flex: 0 0 13rem;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 0.083333rem solid var(--hairline);
  background: var(--bg-chat);
}
```

---

## Verification Plan
1. **Typecheck & Tests**:
   - `npm run typecheck`
   - `npm test`

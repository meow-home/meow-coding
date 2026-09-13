# ModePicker Dropdown Alignment — Design Spec

Date: 2026-09-13
Status: Approved

## Overview

Align the Build / Plan agent mode picker dropdown menu to the left edge of its trigger button, causing the menu to expand towards the right instead of expanding to the left.

## Problem Statement

Currently, the `ModePicker` component sits on the left side of the chat composer footer (`chat-footer-context`). When clicked, its dropdown menu opens right-aligned to the trigger button (`align="right"` default in `Dropdown.tsx`). Because `ModePicker` sits near the left side of the composer, a left-expanding dropdown menu extends towards the container edge instead of flowing naturally into the open area to the right.

## Proposed Solution

1. Update `src/renderer/src/components/chat/ModePicker.tsx` to pass `align="left"` to `<Dropdown>`.
2. `Dropdown.tsx` evaluates `align === 'left'` and positions the portaled element using `{ left: triggerRect.left }`.
3. The dropdown menu's left border aligns with the trigger button's left border, causing the menu to render towards the right.

## Components & File Scope

- `src/renderer/src/components/chat/ModePicker.tsx`: Pass `align="left"` to `<Dropdown>`.

## Verification & Testing

- Run `npm run typecheck` to confirm TS clean.
- Run `npm test` to confirm existing test suite passes.

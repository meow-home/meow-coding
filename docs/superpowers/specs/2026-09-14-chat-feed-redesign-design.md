# Chat Feed UI Redesign — Ultra-Clean Frameless Flow

## Objective
Redesign the chat feed UI in Meow Coding to move away from isolated, boxed message cards and heavy container borders towards a seamless, modern, continuous conversation stream (Ultra-Clean Frameless Flow).

## Constraints
- **Typography & Font Sizes:** Retain 100% of the current font families (`var(--font-ui)`, `var(--font-mono)`, `var(--font-display)`) and font size variables (`var(--fs-xs)`, `var(--fs-sm)`, `var(--fs-md)`, `var(--fs-base)`, `var(--fs-lg)`).
- **Functionality & Performance:** Maintain existing streaming delta handling, auto-scroll geometry (`useChatScroll`), memoization, and DOM virtualization (`content-visibility: auto`).
- **Theme Support:** Fully compatible with both dark and light color themes using standard CSS variables (`var(--bg-chat)`, `var(--bg-panel)`, `var(--bg-hover)`, `var(--hairline)`, `var(--accent)`).

## Visual Design Details

### 1. User Message Bubbles (`.chat-msg.user`)
- **Previous state:** Floating solid dark/accent rectangular cards.
- **New design:** Clean, right-aligned soft bubble with subtle accent tint (`background: rgba(var(--accent-rgb), 0.12)` or soft elevated background) and fine subtle hairline border.
- **Text & Mentions:** White/high-contrast text with highlighted `@file` chips and `/command` badges.

### 2. Assistant Messages (`.chat-msg.assistant`)
- **Previous state:** Messages enclosed in bounded boxes (`.chat-text` with `var(--bg-bubble)` background and full border).
- **New design:** Frameless continuous flow. Markdown content renders directly on the main canvas (`var(--bg-chat)`), eliminating heavy backgrounds and outer borders.
- **Spacing:** Clean vertical rhythm between paragraphs, headings (`h1-h4`), lists, and code blocks.

### 3. Tool Call Cards (`ToolCallCard` / `.tool-call`)
- **Previous state:** Full-width rectangular boxes with separate header/body sections and thick borders.
- **New design:** **Compact Micro-Bars** (~28px-32px high).
  - Single-row summary when collapsed: `[Status Badge / Icon] [Tool Action & Target File/Command] [Duration/Status] [Chevron]`.
  - Left indicator hairline reflecting status (green = success, red = error, purple = file edit).
  - Background fill: subtle `var(--bg-panel)` with smooth hover transition.
  - Expandable detail view: smooth slide-down for diff view, command output, or JSON payload in clean code blocks.

### 4. Reasoning / Thinking Blocks (`.chat-reasoning`)
- **Previous state:** Distinct grey container cards.
- **New design:** Minimalist 1-line collapsible accordion (`Thought for X seconds`) with soft left hairline accent and dim text.

### 5. Layout & Feed Spacing
- Refined vertical margins between feed items (`.chat-feed-content > * + *`) to provide clean separation without blocky visual noise.
- Smooth transitions for expand/collapse states.

## Key Files to Modify
- `src/renderer/src/styles.css`: Updated CSS rules for `.chat-feed`, `.chat-msg`, `.chat-text`, `.tool-call`, and reasoning blocks.
- `src/renderer/src/components/chat/ToolCallCard.tsx`: Restructured layout for compact micro-bar display.
- `src/renderer/src/components/chat/ChatPanel.tsx`: Updated class wrappers and FeedItem rendering structures if needed.
- `src/renderer/src/components/chat/MarkdownText.tsx`: Refined container styling.

## Verification & Testing
- Visual verification across light and dark themes.
- Regression testing via `npm run typecheck` and `npm test`.
- Playwright smoke test check if needed (`npm run e2e`).

# Keep-Alive Nhiều Project + Active Lại Tức Thì — Design Spec

Ngày: 2026-09-06 · Trạng thái: chờ duyệt

## 1. Mục tiêu

Khi người dùng làm việc với nhiều project, agent của project không active **vẫn đang chạy trong
main** (đã xác minh: loop chạy tự trị, main broadcast toàn bộ ChatEvent, transcript lưu đủ) — nhưng
UI gây 2 vấn đề:

1. **Active lại chậm**: chuyển project là unmount toàn bộ panes, remount ChatPanel mới, gọi lại IPC
   `listChatTranscript` (cả transcript, kể cả ảnh dataURL) rồi render toàn bộ feed cùng lúc → feed
   đứng im một lúc rồi hiển thị lại từ đầu.
2. **Không thấy agent đang chạy khi deactive**: vì panel không mount, stream của turn đang chạy bị
   drop ở renderer → người dùng có cảm giác "agent chỉ làm tiếp khi tôi active lại".

Mục tiêu: (a) active lại project **tức thì** — không remount, không reload transcript; (b) feed của
project không active **vẫn live cập nhật** (agent chạy turn nền nhìn thấy được); (c) lần đầu mở
một project (cold open) **nhanh hơn** — transcript phân trang + render nhẹ.

Ngoài phạm vi: khởi động turn mới cho project đang ẩn (headless launch — để dành như một task
riêng), keep-alive terminal/PTY, autonomous nhiều turn liên tục, chạy agent khi app minimize/quit.

## 2. Quyết định

| Chủ đề | Quyết định |
|---|---|
| Kiến trúc chính | **Keep-alive renderer**: giữ panel chat của mọi project đã load, ẩn bằng CSS, không remount |
| State renderer | `runtime` single-slot → `runtimes: Record<projectPath, WorkspaceRuntime>` + danh sách thứ tự LRU |
| Kích hoạt lại | IPC mới nhẹ `WorkspaceActivate(path)`: chỉ set `activeProject` + git poll + watcher; không close terminals, không re-init agents/MCP |
| Lần đầu mở project | Giữ nguyên `WorkspaceOpen` đầy đủ như hiện nay |
| Load transcript | Thêm `SessionStore.transcriptWindow(id, { limit, beforeId })` → `{ items, hasMore }`; `listChatTranscript(agentId, opts?)` trả window ~50 item cuối |
| Render nhẹ | CSS `content-visibility: auto` + `contain-intrinsic-size` cho feed row; `loading="lazy"`/`decoding="async"` cho ảnh |
| Giới hạn memory | Keep-alive tối đa 5 project (hằng số `MAX_KEEP_ALIVE = 5`); evict LRU, không evict project có agent đang chạy |
| Terminal/PTY | Giữ hành vi cũ (đóng khi chuyển project) — không keep-alive terminal |
| `isChatRunning`/`getPendingPrompt` | Chỉ gọi lúc cold mount — không phải mỗi lần activate |
| Đụng contract | Thêm 1 channel `WorkspaceActivate` (Channels + AgentApi + preload + handler + ipc-contract test); `listChatTranscript` đổi signature (optional opts) |
| Test | Unit cho `transcriptWindow`; typecheck toàn bộ; unit suite hiện có |

## 3. Kiến trúc

### 3.1 Renderer — keep-alive (App.tsx)

```
App.tsx
  runtimes: Record<projectPath, WorkspaceRuntime>   // thay runtime single
  keepAliveOrder: string[]                          // LRU, mới nhất đứng đầu

  openWorkspace(path)            // chỉ khi project CHƯA load
    ├─ window.api.openWorkspace(path) → rt
    ├─ runtimes[path] = rt
    └─ push path lên đầu keepAliveOrder

  activate(path)                 // đã load → toggle nhanh
    ├─ chưa có trong runtimes? → openWorkspace(path) (cold)
    ├─ window.api.activateWorkspace(path)          // IPC nhẹ (Phần B)
    ├─ setActivePath(path)
    ├─ setTerminals([]) + dọn termsRef/buffersRef  // terminal đóng như hành vi cũ
    └─ reorder keepAliveOrder; evict nếu vượt MAX_KEEP_ALIVE

  render
    ├─ active project: <WorkspaceView…/> bình thường (PaneTabs, panes, composer)
    └─ mỗi project khác trong keepAliveOrder:
         <div className="workspace-hidden"><WorkspaceView…/></div>
         // display:none → vẫn mount, vẫn subscribe onChatEvent, feed vẫn stream
```

- **`WorkspaceView`** = phần render panes đang nằm trong App (PaneTabs + BackgroundPanel + composer
  path). Tách thành component dùng chung để render n lần; active vs hidden chỉ khác class wrapper.
  `PaneTabs`/`panes`/`activeTabByPath` vốn đã key theo project (`activeTabByPath[path]`) — giữ được.
- **Event handlers App-level** (hiện cập nhật `runtime` active) chuyển sang cập nhật đúng entry:
  - `onAgentState({ agentId, state })` → tìm runtime nào chứa agentId → cập nhật entry đó.
  - `onGitStatus({ projectPath, git })` → `runtimes[projectPath].git`.
  - `onAgentConfig({ agentId, config })` → tìm runtime chứa agentId → cập nhật `workspace.agents`.
  - `onArtifactsChanged`/`needsInput` vốn đã key theo projectPath — không đổi.
  - `onPtyData` buffer theo agentId — không đổi.
- **ChatPanel giữ nguyên**: mount effect (subscribe + load transcript/cold-calls) chạy một lần khi
  project được load lần đầu; không chạy lại trên mỗi lần activate. Vì panel luôn mount, feed nhận
  `onChatEvent` liên tục → stream turn nền vẫn cập nhật khi project ẩn.
- **Terminal** (`terminals` state): giữ hành vi cũ — không keep-alive. Khi activate, main đóng các
  terminal qua `closeAllTerminals()` trong `WorkspaceActivate` (xem 3.2) → renderer `setTerminals([])`
  và dọn `termsRef`/`buffersRef`. Evict/unmount project cũng dọn `termsRef`/`buffersRef` của agent
  thuộc project đó.

### 3.2 Main — kênh activation nhẹ (index.ts)

```
ipcMain.handle(Channels.WorkspaceActivate, (_e, projectPath: string) => {
  const ws = mainApp.workspaces.get(projectPath)
  if (!ws) throw new Error(`Workspace not found: ${projectPath}`)
  mainApp.activeProject = projectPath
  mainApp.meowAgent.setProjectPath(projectPath)
  mainApp.startGitPoll(projectPath)
  mainApp.startFileWatcher(projectPath)
  return mainApp.runtimeFor(ws)
})
```

- **Không** vòng lặp `addAgent`, **không** `prepareWorkspace` (không re-init agents/MCP) → trả về
  ngay, không có work nặng chờ IPC. Vẫn gọi `closeAllTerminals()` vì terminal không keep-alive
  (không block: `pty.stop` là async fire-and-forget).
- `activeProject` luôn đúng → `dirList`, artifacts, `resolveAgentName`, watcher changes gắn đúng
  project.
- Agent của project vừa activate đã được đăng ký từ lần `openWorkspace` đầu — không cần re-register.
- Channel mới: thêm `WorkspaceActivate` vào `Channels` (src/shared/ipc.ts) + `activateWorkspace` vào
  `AgentApi` + preload impl + handler + test `tests/unit/ipc-contract.test.ts`.

### 3.3 Transcript phân trang (session.ts / ipc / ChatPanel)

- `SessionStore.transcriptWindow(id, opts?: { limit?: number; beforeId?: string })`:
  lấy `items`, nếu `beforeId` → tìm index của item có `item.message?.id === beforeId`
  (hoặc `item.tool?.id === beforeId`); cắt từ đó lùi `limit` item; ghi chú `hasMore = index > 0`.
  Không `beforeId` → cửa sổ cuối `limit` item. Trả `{ items, hasMore }`.

```
type TranscriptWindow = { items: ChatTranscriptItem[]; hasMore: boolean }
```

- IPC `listChatTranscript(agentId: string, opts?: { limit?: number; beforeId?: string })`:
  main → `meowAgent.listTranscriptWindow(agentId, opts)` → `store.transcriptWindow(activeSessionId, opts)`.
- ChatPanel `loadTranscript` đổi sang lấy window cuối (mặc định 50):
  - set `items` = items (đúng thứ tự, tail = cuối transcript).
  - lưu `hasMoreRef`/state; anchor scroll về cuối như cũ.
- "Tải tin cũ hơn": khi scroll chạm gần đầu feed (hoặc nút "Load earlier" khi `hasMore`), gọi
  `listChatTranscript(agentId, { limit, beforeId: items[0]?.id })` → **prepend** kết quả + cập nhật
  `hasMore`. (ID trùng lặp an toàn: skip item có id đã có trong `items`.)
- **Đồng bộ stream delta**: khi turn mới chạy, `flushDeltas` append vào cuối `items` như cũ. Nếu
  transcript lúc cold mount vẫn rơi giữa turn (turn bắt đầu sau khi load) → các tin nhắn mới đến qua
  `onChatEvent` (`text-delta`/`done`) tự nối vào feed — như hiện tại; không cần reload cả transcript.
- Lưu ý merge: hiện tại mount load full transcript một lần. Khi đổi sang window, phần "cũ hơn ngoài
  window" chỉ load khi scroll — đúng mục tiêu giảm IPC/render lúc cold open.

### 3.4 Render nhẹ (styles.css / chat components)

- Feed row: `content-visibility: auto; contain-intrinsic-size: auto [block-size];` — Chromium bỏ qua
  layout/paint các row ngoài viewport; áp trên container/row của message feed (đừng áp lên element
  có `overflow` cha gây lỗi scroll; cần kiểm tra tương tác với `useChatScroll`).
- Ảnh trong message: `<img loading="lazy" decoding="async" …>`.

### 3.5 Giới hạn memory & evict

- `MAX_KEEP_ALIVE = 5` (hằng số trong App.tsx).
- App duy trì `runningAgents: Set<string>` cập nhật từ `onAgentState` (status running/idle) + cũng
  được đồng bộ từ `onChatEvent` (`turn-started` → add; `done`/`error` → delete).
- Sau khi `activate(path)` (đã tồn tại) → reorder LRU; nếu `keepAliveOrder.length > MAX`:
  - Lấy project cũ nhất (cuối danh sách) `victim` ≠ `activePath`.
  - Nếu `victim` có agent thuộc `runningAgents` → **không evict**, retry sau khi turn xong
    (theo dõi qua cùng event handler: khi `done`/`error` làm `runningAgents` đổi và danh sách vẫn
    vượt → chạy lại bước evict; có guard chống loop).
  - Evict: xóa khỏi `runtimes` + `keepAliveOrder` → unmount panes → ChatPanel cleanup unsubscribe.
- Terminal của victim: đã bị main đóng khi chuyển đi (hành vi cũ) — dọn `termsRef`/`buffersRef`.

## 4. Hành vi biên

| Tình huống | Hành vi |
|---|---|
| Đang ở A chạy agent, chuyển B rồi quay A | Toggle ẩn/hiện, tức thì; feed A đã live cập nhật từ khi ẩn |
| Turn của agent A kết thúc khi A đang ẩn | Trạng thái idle cập nhật qua `onChatEvent done` → header/badge A (khi hiện) đúng |
| Agent A đang chờ permission/question khi A ẩn | Notification + sidebar badge (đã có); bấm vào → activate A, prompt đã render sẵn trong panel giữ sống |
| Cold open project B lần đầu | `openWorkspace` đầy đủ như cũ; transcript window 50 cuối + `hasMore` |
| Feed dài, cold open | Chỉ render 50 cuối, scroll lên tải dần; row ngoài viewport không paint |
| Vượt `MAX_KEEP_ALIVE` | Evict LRU trừ project có agent đang chạy; evict lại sau khi turn xong |
| Xóa project đang keep-alive | `removeWorkspace` → xóa khỏi `runtimes`, unmount, cleanup subscribe |
| Terminal của project evicted/đã chuyển | Không keep-alive; đóng + dọn buffer như cũ |
| `activeTabByPath` | Đã key theo project — tab của project ẩn giữ nguyên khi quay lại |
| Turn mới cho project đang ẩn | **Không thể** từ composer (ngoài phạm vi) — cần activate trước |

## 5. Test

- **Unit `session.ts`**: `transcriptWindow` — window cuối đúng thứ tự; `beforeId` ở đầu/giữa/cuối;
  `beforeId` không tồn tại → trả window cuối; transcript ngắn hơn limit; empty session → `hasMore: false`.
- **Unit `ipc-contract.test.ts`**: cập nhật contract mới (WorkspaceActivate channel + AgentApi method).
- **Typecheck**: node/web/extension/server.
- **Unit suite hiện có**: 1161+ test pass.
- **Thủ công (smoke)**:
  1. Mở 2 project A, B; chạy agent A rồi chuyển B → feed A vẫn nhảy trong background (qua panel ẩn
     hoặc quay lại xem).
  2. Quay lại A → không thấy feed trống/đứng; transcript hiện ngay không reload.
  3. Trong A, mở session dài (nhiều tool/ảnh) → cold open render nhanh; scroll lên tải tin cũ.
  4. Mở > 5 project → project cũ nhất bị evict (không crash).

## 6. Tiêu chí thành công

- Chuyển project → quay lại: không remount, không gọi lại `listChatTranscript`, không feed trống.
- Feed của project không active tiếp tục cập nhật (agent chạy turn nền nhìn thấy được).
- Cold open session dài không còn "đứng im" — chỉ render window gần đây, tải dần khi scroll.
- Vượt giới hạn keep-alive không crash, evict đúng, không mất state agent đang chạy.
- Typecheck + unit suite pass; ipc-contract cập nhật.

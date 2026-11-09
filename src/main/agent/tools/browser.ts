import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolRunResult } from './types'
import type { BrowserCommandResult } from '../../../shared/browser-types'
import type { BrowserCall, BrowserRouterLike } from '../../browser/browser-backend'

const NO_CONTEXT = 'browser: no session context'

function callFor(ctx: ToolContext): BrowserCall | null {
  const ownerId = ctx.snapshotAgentId ?? ctx.agentId
  if (!ownerId) return null
  return { ownerId, ask: q => ctx.ask(q), ...(ctx.signal ? { signal: ctx.signal } : {}) }
}

export function createBrowserTools(router: BrowserRouterLike): ToolDefinition[] {
  const fmt = (r: BrowserCommandResult): ToolRunResult =>
    r.ok ? { output: JSON.stringify(r.data ?? {}, null, 2) } : { error: r.error }

  return [
    {
      name: 'browser_start',
      description:
        'Ensure the browser is ready for this session. The built-in browser returns immediately; Chrome opens, ' +
        'shows the extension install steps, and waits for the user to approve the extension in Meow. ' +
        '`target` switches this session between the built-in browser and Chrome before starting.',
      schema: z.object({
        target: z.enum(['builtin', 'chrome']).optional().describe('Backend to use for this session: builtin or chrome.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { target } = input as unknown as { target?: 'builtin' | 'chrome' }
        if (target) {
          try {
            router.select(call.ownerId, target)
          } catch (err) {
            return { error: `browser_start: ${err instanceof Error ? err.message : String(err)}` }
          }
        }
        return router.backendFor(call.ownerId).start(call)
      }
    },
    {
      name: 'browser_navigate',
      description:
        'Open a URL in a new tab of this session\'s browser. Never navigates or hijacks an existing tab. ' +
        'Returns a tabId for other browser_* tools.',
      schema: z.object({
        url: z.string().describe('The http(s) URL to open.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { url } = input as unknown as { url: string }
        if (!/^https?:\/\//i.test(url)) return { error: `browser_navigate: invalid url: ${url}` }
        return fmt(await router.backendFor(call.ownerId).execute('navigate', { url }, call))
      }
    },
    {
      name: 'browser_open_tab',
      description:
        'Open a URL in a new tab of this session\'s browser without switching the visible tab. ' +
        'Returns a tabId for other browser_* tools.',
      schema: z.object({
        url: z.string().describe('The http(s) URL to open.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { url } = input as unknown as { url: string }
        if (!/^https?:\/\//i.test(url)) return { error: `browser_open_tab: invalid url: ${url}` }
        return fmt(await router.backendFor(call.ownerId).execute('openTab', { url }, call))
      }
    },
    {
      name: 'browser_click',
      description: 'Click an element by snapshot ref (preferred), CSS selector, or viewport coordinates (x, y).',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read, e.g. r4.'),
        selector: z.string().optional().describe('CSS selector of the element to click.'),
        x: z.number().optional().describe('Viewport x coordinate (requires y).'),
        y: z.number().optional().describe('Viewport y coordinate (requires x).'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { ref, selector, x, y, tabId } = input as unknown as { ref?: string; selector?: string; x?: number; y?: number; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        if (ref != null) return fmt(await router.backendFor(call.ownerId).execute('click', { ...base, ref }, call))
        return fmt(await router.backendFor(call.ownerId).execute('click', selector ? { ...base, selector } : { ...base, x, y }, call))
      }
    },
    {
      name: 'browser_type',
      description: 'Type text into an input/textarea/select by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the input element.'),
        text: z.string().describe('Text to type.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { ref, selector, text, tabId } = input as unknown as { ref?: string; selector?: string; text: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await router.backendFor(call.ownerId).execute('type', { ...base, ...(ref != null ? { ref, text } : { selector, text }) }, call))
      }
    },
    {
      name: 'browser_select',
      description: 'Select an option value in a <select> by snapshot ref (preferred) or CSS selector.',
      schema: z.object({
        ref: z.string().optional().describe('Snapshot ref from browser_read (preferred).'),
        selector: z.string().optional().describe('CSS selector of the select element.'),
        value: z.string().describe('Option value to select.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { ref, selector, value, tabId } = input as unknown as { ref?: string; selector?: string; value: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await router.backendFor(call.ownerId).execute('select', { ...base, ...(ref != null ? { ref, value } : { selector, value }) }, call))
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page (direction: up/down/top/bottom) or bring a selector into view.',
      schema: z.object({
        direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
        selector: z.string().optional().describe('CSS selector to scroll into view.'),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { direction, selector, tabId } = input as unknown as { direction?: 'up' | 'down' | 'top' | 'bottom'; selector?: string; tabId?: number }
        const base: Record<string, unknown> = {}
        if (tabId != null) base.tabId = tabId
        return fmt(await router.backendFor(call.ownerId).execute('scroll', selector ? { ...base, selector } : { ...base, direction: direction ?? 'down' }, call))
      }
    },
    {
      name: 'browser_read',
      description:
        'Snapshot the target tab (or tabId) into a page-structure file, Playwright-MCP style: ' +
        'every element on one indented line as `role "name" [ref]` (anchors <a> are role "link", plus ' +
        'button, textbox, checkbox, ... — the snapshot is complete, never truncated). ' +
        'Returns the file path, node count and a preview. Read the file (with the file read tool, in ' +
        'chunks if large) to see every element, then click/type/select using the [ref] shown.',
      schema: z.object({
        mode: z.enum(['interactive', 'full']).optional().describe('interactive (default) refs interactive elements; full refs every element.'),
        tabId: z.number().int().optional().describe('Optional tab id to snapshot; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { mode, tabId } = input as unknown as { mode?: 'interactive' | 'full'; tabId?: number }
        const params: Record<string, unknown> = {}
        if (mode != null) params.mode = mode
        if (tabId != null) params.tabId = tabId
        return fmt(await router.backendFor(call.ownerId).execute('read', params, call))
      }
    },
    {
      name: 'browser_list_tabs',
      description: 'List open tabs with id, title, url, active, window and tab-group info.',
      schema: z.object({}),
      async run(_input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        return fmt(await router.backendFor(call.ownerId).execute('listTabs', {}, call))
      }
    },
    {
      name: 'browser_switch_tab',
      description: 'Activate a tab by its id (from browser_list_tabs) without focusing the browser window.',
      schema: z.object({
        tabId: z.number().describe('Tab id to activate.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { tabId } = input as unknown as { tabId: number }
        return fmt(await router.backendFor(call.ownerId).execute('switchTab', { tabId }, call))
      }
    },
    {
      name: 'browser_close_tab',
      description: 'Close a tab by its id (from browser_list_tabs).',
      schema: z.object({
        tabId: z.number().describe('Tab id to close.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { tabId } = input as unknown as { tabId: number }
        return fmt(await router.backendFor(call.ownerId).execute('closeTab', { tabId }, call))
      }
    },
    {
      name: 'browser_console',
      description: 'Return recent browser console logs (errors, warnings, page messages).',
      schema: z.object({
        limit: z.number().int().positive().max(200).optional()
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { limit } = input as unknown as { limit?: number }
        return { output: JSON.stringify(router.backendFor(call.ownerId).getConsoleLogs(call, limit), null, 2) }
      }
    },
    {
      name: 'browser_network',
      description: 'Return recent network requests observed on the page (method, url, status).',
      schema: z.object({
        limit: z.number().int().positive().max(200).optional()
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { limit } = input as unknown as { limit?: number }
        return { output: JSON.stringify(router.backendFor(call.ownerId).getNetworkLogs(call, limit), null, 2) }
      }
    },
    {
      name: 'browser_wait_for',
      description: 'Wait until a CSS selector exists on the page (polling), up to timeoutMs.',
      schema: z.object({
        selector: z.string().describe('CSS selector to wait for.'),
        timeoutMs: z.number().int().positive().max(60_000).optional(),
        tabId: z.number().int().optional().describe('Optional tab id to act on; defaults to the active/visible tab.')
      }),
      async run(input, ctx): Promise<ToolRunResult> {
        const call = callFor(ctx)
        if (!call) return { error: NO_CONTEXT }
        const { selector, timeoutMs, tabId } = input as unknown as { selector: string; timeoutMs?: number; tabId?: number }
        const params: Record<string, unknown> = { selector, timeoutMs: timeoutMs ?? 10_000 }
        if (tabId != null) params.tabId = tabId
        return fmt(await router.backendFor(call.ownerId).execute('waitFor', params, call, (timeoutMs ?? 10_000) + 5000))
      }
    }
  ]
}

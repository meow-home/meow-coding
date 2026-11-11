import path from 'node:path'
import type { AgentConfig, ModelRef, NewAgentInput, SessionDelegation, Workspace } from '../../shared/types'
import type { CreateTaskBody, ModelDto, TaskDto } from '../../shared/external-api-types'
import { validateTaskText, type SessionDelegationService } from '../session-delegation-service'
import { formatModelCandidates, modelLabel, resolveModelQuery } from '../model-select'
import { normalizeProjectPath } from '../session-delegation-store'
import { ExternalApiError } from './errors'
import type { ExternalApiHandler } from './server'

export interface ExternalDelegationFacadeDeps {
  workspaces: {
    load(): Workspace[]
    add(projectPath: string, name: string): Workspace
    addAgent(projectPath: string, input: NewAgentInput): Workspace
  }
  ensureAgent(agent: AgentConfig): Promise<void>
  delegations: Pick<SessionDelegationService, 'createExternal' | 'cancel' | 'getStatus' | 'getStore' | 'notifyAgentAvailable'>
  isDirectory(p: string): boolean
  onWorkspaceChanged(ws: Workspace): void
  version: string
  defaultModel(): ModelRef | null
  /** Every model the user has configured; a requested model is resolved against it. */
  availableModels(): Promise<ModelRef[]>
  /** Moves an existing session onto a model before its task is queued. */
  applyModel(agentId: string, model: ModelRef): void
}

export function toTaskDto(d: SessionDelegation): TaskDto {
  return {
    id: d.id,
    status: d.status,
    sessionId: d.targetAgentId,
    projectPath: d.projectPath,
    planKey: d.planKey ?? '',
    createdAt: d.createdAt,
    ...(d.startedAt !== undefined ? { startedAt: d.startedAt } : {}),
    ...(d.finishedAt !== undefined ? { finishedAt: d.finishedAt } : {}),
    ...(d.result !== undefined ? { result: d.result } : {}),
    ...(d.resultTruncated ? { resultTruncated: true } : {}),
    ...(d.error !== undefined ? { error: d.error } : {}),
    ...(d.endReason !== undefined ? { endReason: d.endReason } : {}),
    touchedFiles: d.touchedFiles ?? []
  }
}

export class ExternalDelegationFacade implements ExternalApiHandler {
  constructor(private deps: ExternalDelegationFacadeDeps) {}

  version(): string {
    return this.deps.version
  }

  async createTask(body: CreateTaskBody): Promise<TaskDto> {
    try {
      validateTaskText(body.task)
    } catch (err) {
      throw new ExternalApiError(400, err instanceof Error ? err.message : String(err))
    }
    const requested = await this.requestedModel(body.model)
    const { ws, agent, planKey, created } = body.sessionId !== undefined
      ? this.resolveSession(body.sessionId)
      : this.resolvePlanSession(body, requested)
    await this.deps.ensureAgent(agent)
    // A requested model wins over the session's own one; a session created just
    // above already carries it from addAgent.
    if (requested && !created) this.applyModel(agent, requested)
    try {
      const rec = this.deps.delegations.createExternal({
        projectPath: ws.projectPath,
        targetAgentId: agent.id,
        task: body.task,
        planKey
      })
      return toTaskDto(rec)
    } catch (err) {
      throw new ExternalApiError(400, err instanceof Error ? err.message : String(err))
    }
  }

  /** The models an external client may ask for, with the fallback one marked. */
  async listModels(): Promise<ModelDto[]> {
    const models = await this.deps.availableModels()
    const fallback = this.deps.defaultModel()
    return models.map(ref => ({
      id: modelLabel(ref),
      provider: ref.provider,
      model: ref.model,
      ...(ref.accountId ? { accountId: ref.accountId } : {}),
      ...(ref.accountLabel ? { accountLabel: ref.accountLabel } : {}),
      ...(fallback && modelLabel(ref) === modelLabel(fallback) && ref.accountId === fallback.accountId
        ? { default: true }
        : {})
    }))
  }

  /**
   * Resolves a free-form model request the way `delegate_session` does: a fuzzy
   * name is accepted, ambiguity is a 400 that lists the alternatives so the
   * external model can retry with a precise id.
   */
  private async requestedModel(query: string | undefined): Promise<ModelRef | undefined> {
    const requested = query?.trim()
    if (!requested) return undefined
    const candidates = await this.deps.availableModels()
    if (candidates.length === 0) {
      throw new ExternalApiError(400, '[meow] No models are configured. Add a provider in Settings.')
    }
    const resolved = resolveModelQuery(requested, candidates)
    if (resolved.match) return resolved.match
    if (resolved.candidates.length > 0) {
      throw new ExternalApiError(
        400,
        `[meow] Model "${requested}" is ambiguous. Pass one of: ${formatModelCandidates(resolved.candidates)}.`
      )
    }
    throw new ExternalApiError(
      400,
      `[meow] Model "${requested}" is not configured. Available: ${formatModelCandidates(candidates)}.`
    )
  }

  private applyModel(agent: AgentConfig, model: ModelRef): void {
    if (agent.model === modelLabel(model) && agent.accountId === model.accountId) return
    this.deps.applyModel(agent.id, model)
  }

  getTask(id: string): TaskDto | undefined {
    const rec = this.deps.delegations.getStatus(id)
    return rec && rec.sourceKind === 'external' ? toTaskDto(rec) : undefined
  }

  async cancelTask(id: string): Promise<TaskDto> {
    if (!this.getTask(id)) throw new ExternalApiError(404, `[meow] Unknown task: ${id}`)
    return toTaskDto(await this.deps.delegations.cancel(id))
  }

  /** Registers the target of every queued external task and wakes its pump;
   *  the service's startup pump runs before workspaces are opened. */
  async resumeQueued(): Promise<void> {
    const targets = new Set(
      this.externalRecords().filter(d => d.status === 'queued').map(d => d.targetAgentId)
    )
    for (const target of targets) {
      const agent = this.deps.workspaces.load().flatMap(w => w.agents).find(a => a.id === target)
      if (!agent) continue
      await this.deps.ensureAgent(agent)
      this.deps.delegations.notifyAgentAvailable(target)
    }
  }

  private externalRecords(projectPath?: string): SessionDelegation[] {
    return this.deps.delegations.getStore()
      .list(projectPath ? { projectPath } : undefined)
      .filter(d => d.sourceKind === 'external')
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  private resolveSession(sessionId: string): { ws: Workspace; agent: AgentConfig; planKey: string; created: boolean } {
    const rec = this.externalRecords().find(d => d.targetAgentId === sessionId)
    const ws = rec && this.findWorkspace(rec.projectPath)
    const agent = ws?.agents.find(a => a.id === sessionId)
    if (!rec || !ws || !agent) throw new ExternalApiError(404, `[meow] Unknown external session: ${sessionId}`)
    return { ws, agent, planKey: rec.planKey ?? '', created: false }
  }

  private resolvePlanSession(body: CreateTaskBody, requested?: ModelRef): { ws: Workspace; agent: AgentConfig; planKey: string; created: boolean } {
    const cwd = path.resolve(body.cwd)
    if (!this.deps.isDirectory(cwd)) throw new ExternalApiError(400, `[meow] cwd does not exist: ${body.cwd}`)
    let ws = this.findWorkspace(cwd)
    if (!ws) {
      ws = this.deps.workspaces.add(cwd, path.basename(cwd))
      this.deps.onWorkspaceChanged(ws)
    }
    const planKey = normalizeProjectPath(path.resolve(cwd, body.planKey))
    const reused = this.externalRecords(ws.projectPath)
      .filter(d => d.planKey === planKey)
      .map(d => ws!.agents.find(a => a.id === d.targetAgentId))
      .find((a): a is AgentConfig => a !== undefined)
    if (reused) return { ws, agent: reused, planKey, created: false }
    const title = body.title?.trim() || path.basename(body.planKey, path.extname(body.planKey)) || 'plan'
    const model = requested ?? this.deps.defaultModel()
    const updated = this.deps.workspaces.addAgent(ws.projectPath, {
      name: `[claude] ${title}`,
      templateId: 'meow',
      cwd: ws.projectPath,
      kind: 'native',
      ...(model ? { model: `${model.provider}/${model.model}` } : {}),
      ...(model?.accountId ? { accountId: model.accountId } : {})
    })
    this.deps.onWorkspaceChanged(updated)
    return { ws: updated, agent: updated.agents[updated.agents.length - 1], planKey, created: true }
  }

  private findWorkspace(projectPath: string): Workspace | undefined {
    const key = normalizeProjectPath(path.resolve(projectPath))
    return this.deps.workspaces.load().find(w => normalizeProjectPath(path.resolve(w.projectPath)) === key)
  }
}

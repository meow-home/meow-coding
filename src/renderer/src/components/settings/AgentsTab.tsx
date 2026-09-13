import type { AgentSettings, MeowSettings, ModelRef, SubagentType } from '@shared/types'

const SUBMODEL_ROLES = ['research', 'general', 'reviewer'] as const

interface Props {
  agents: AgentSettings[]
  providers: MeowSettings['providers']
  subagentModels?: Partial<Record<SubagentType, ModelRef>>
  onChangeAgents: (agents: AgentSettings[]) => void
  onChangeSubagentModels: (models?: Partial<Record<SubagentType, ModelRef>>) => void
}

export default function AgentsTab({ providers, subagentModels, onChangeSubagentModels }: Props) {
  const setRole = (role: SubagentType, ref: ModelRef | undefined) => {
    const next = { ...(subagentModels ?? {}) }
    if (ref) next[role] = ref
    else delete next[role]
    onChangeSubagentModels(Object.keys(next).length > 0 ? next : undefined)
  }

  return (
    <div className="settings-tab agents-tab">
      <div className="settings-section">
        <h4 className="settings-section-header">Sub-agent Models</h4>
        <p className="settings-hint">
          Models used when the main session dispatches sub-agents. Leave empty to inherit the main session model.
        </p>

        <div className="subagent-models-grid">
          {SUBMODEL_ROLES.map(role => {
            const current = subagentModels?.[role]
            const selectedProvider = current?.providerId ?? ''
            const selectedModel = current?.modelId ?? ''
            const providerObj = providers.find(p => p.id === selectedProvider)
            const availableModels = providerObj?.models ?? []

            return (
              <div key={role} className="subagent-model-row">
                <div className="subagent-model-header">
                  <span className="subagent-role-name">{role}</span>
                  {current && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setRole(role, undefined)}
                    >
                      Use main session model
                    </button>
                  )}
                </div>

                <div className="subagent-model-controls">
                  <select
                    className="input select"
                    value={selectedProvider}
                    onChange={e => {
                      const pid = e.target.value
                      if (!pid) {
                        setRole(role, undefined)
                        return
                      }
                      const firstModel = providers.find(p => p.id === pid)?.models[0]?.id ?? ''
                      setRole(role, { providerId: pid, modelId: firstModel })
                    }}
                  >
                    <option value="">(inherit main session model)</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>

                  <select
                    className="input select"
                    disabled={!selectedProvider}
                    value={selectedModel}
                    onChange={e => {
                      if (!selectedProvider) return
                      setRole(role, { providerId: selectedProvider, modelId: e.target.value })
                    }}
                  >
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

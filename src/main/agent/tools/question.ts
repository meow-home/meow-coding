import { z } from 'zod'
import type { ToolDefinition, ToolRunResult } from './types'
import type { QuestionOption, QuestionPrompt } from '../../../shared/types'

const optionSchema = z.object({
  label: z.string().describe('Display text (1-5 words, concise)'),
  description: z.string().optional().describe('Explanation of choice')
})

// The model sometimes returns `options` as a non-array (e.g. a string) or as
// an array of plain strings instead of `{ label }` objects. The schema is only
// used to build the input schema sent to the model, never to validate the
// actual arguments, so a malformed value used to flow straight through to the
// UI and crash the renderer (`options.map is not a function`) or render no
// choices at all. Coerce every shape to a valid `{ label }` array (or drop it)
// before it reaches the prompt.
function normalizeOptions(options: unknown): QuestionOption[] | undefined {
  if (!Array.isArray(options)) return undefined
  const valid: QuestionOption[] = []
  for (const o of options) {
    if (typeof o === 'string' && o.trim()) {
      valid.push({ label: o.trim() })
    } else if (o && typeof o === 'object' && typeof (o as QuestionOption).label === 'string') {
      valid.push({ label: (o as QuestionOption).label, description: (o as QuestionOption).description })
    }
  }
  return valid.length > 0 ? valid : undefined
}

export const questionTool: ToolDefinition = {
  name: 'question',
  description:
    'Ask the user a question and return their answer. Use this tool instead of writing questions ' +
    'as plain text: it renders an interactive form the user can answer with one click. For choice ' +
    'questions provide `options`; answers come back as the selected label(s).',
  schema: z.object({
    question: z.string().describe('The question to ask the user.'),
    header: z.string().optional().describe('Very short label (max 30 chars)'),
    options: z.array(optionSchema).optional().describe('Available choices'),
    multiple: z.boolean().optional().describe('Allow selecting multiple choices'),
    custom: z.boolean().optional().describe('Allow typing a custom answer (default: true)')
  }),
  async run(input, ctx): Promise<ToolRunResult> {
    const { question, header, options, multiple, custom } = input as unknown as QuestionPrompt
    const answer = await ctx.ask({ question, header, options: normalizeOptions(options), multiple, custom })
    if (answer === null || answer.trim() === '') {
      return { error: 'question: user did not answer' }
    }
    return { output: `User answered: ${answer}` }
  }
}

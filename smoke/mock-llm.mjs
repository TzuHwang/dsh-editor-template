// A local stand-in for DeepSeek's Messages-compatible endpoint, for the smoke
// test: it records every request and answers deterministically.
//
// Answers "ok", or a tool call when the last user text contains a trigger:
//   TRIGGER_ASK   -> ask_user_question
//   TRIGGER_WRITE -> pwsh asking for wider sandbox access (an approval prompt)
//   TRIGGER_EDIT  -> read <workspace>/notes.md, then write it
// After a tool result it answers "done".
import { createServer } from 'node:http'

/** What the AI writes for TRIGGER_EDIT. */
export const AI_EDIT_TEXT = '# Notes\n\nwritten by the AI\n'

function lastUser(messages) {
  const last = messages.at(-1)
  if (last?.role !== 'user') return { text: '', toolResult: false }
  const parts = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
  return { text: parts.map(p => p.text ?? '').join('\n'), toolResult: parts.some(p => p.type === 'tool_result') }
}

function lastToolName(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || typeof message.content === 'string') continue
    const use = message.content.findLast(part => part.type === 'tool_use')
    if (use !== undefined) return use.name
  }
  return undefined
}

function plan(request, workspace) {
  const messages = request.messages ?? []
  const { text, toolResult } = lastUser(messages)
  const notes = `${workspace}/notes.md`
  if (toolResult) {
    if (lastToolName(messages) === 'read') return { tool: 'write', input: { file_path: notes, content: AI_EDIT_TEXT } }
    return { text: 'done' }
  }
  if (text.includes('TRIGGER_ASK')) {
    return { tool: 'ask_user_question', input: { questions: [{ id: 'q1', question: 'Pick a colour', options: [{ label: 'Red' }, { label: 'Blue' }] }] } }
  }
  if (text.includes('TRIGGER_WRITE')) {
    return { tool: 'pwsh', input: { command: 'Write-Output smoke', description: 'Smoke approval', sandbox_permissions: 'danger-full-access', justification: 'Smoke test of the approval prompt.' } }
  }
  if (text.includes('TRIGGER_EDIT')) return { tool: 'read', input: { file_path: notes } }
  return { text: 'ok' }
}

/**
 * Start the endpoint on a free loopback port.
 * @param {string} workspace - workspace root the AI edits (forward slashes).
 * @returns {Promise<{ url: string, requests: object[], close(): Promise<void> }>}
 */
export async function startMockLlm(workspace) {
  const requests = []
  let counter = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = body ? JSON.parse(body) : {}
    requests.push({ url: req.url, body: request })
    if (!req.url.includes('/messages')) {
      res.setHeader('content-type', 'application/json')
      res.end('{"data":[],"has_more":false}')
      return
    }
    const step = plan(request, workspace)
    counter++
    const message = { id: `msg_${counter}`, type: 'message', role: 'assistant', model: request.model ?? 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }
    res.setHeader('content-type', 'text/event-stream')
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
    send('message_start', { message })
    if (step.tool !== undefined) {
      send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${counter}`, name: step.tool, input: {} } })
      send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } })
      send('content_block_stop', { index: 0 })
      send('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 1 } })
    } else {
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: step.text } })
      send('content_block_stop', { index: 0 })
      send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    }
    send('message_stop', {})
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

/** Text parts of the last user message of every Messages request, in order. */
export function userTurns(requests) {
  return requests
    .filter(request => request.url.includes('/messages'))
    .map(request => {
      const last = request.body.messages.at(-1)
      const parts = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
      return parts.map(part => part.type === 'tool_result' ? `[tool_result] ${JSON.stringify(part.content)}` : part.text ?? '')
    })
}

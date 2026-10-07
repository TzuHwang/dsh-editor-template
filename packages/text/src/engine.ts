/**
 * The `text` engine: CodeMirror 6 in source mode (design Q4), with a Markdown
 * preview toggle. Framework-free: it owns the DOM it is mounted into.
 */
import type { EditorEngine, EngineBinding, EngineInstance } from '@dsh-editor/core'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state'
import { Decoration, EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { diffText } from '@dsh-editor/core/diff'

const MARKDOWN = ['md', 'markdown']
const PYTHON = ['py', 'pyi']
const PLAIN = ['txt', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'html', 'xml', 'sh', 'ps1', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'sql', 'log']

/** How long text that arrived from disk stays highlighted. */
const FLASH_MS = 2000

function languageFor(extension: string): Extension {
  if (MARKDOWN.includes(extension)) return markdown()
  if (PYTHON.includes(extension)) return python()
  return []
}

// Highlight for ranges that changed on disk (e.g. the AI edited them).
const addFlash = StateEffect.define<{ from: number; to: number }>()
const clearFlash = StateEffect.define<null>()
const flashMark = Decoration.mark({ class: 'dsh-editor-flash' })
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(clearFlash)) next = Decoration.none
      if (effect.is(addFlash) && effect.value.to > effect.value.from) {
        next = next.update({ add: [flashMark.range(effect.value.from, effect.value.to)] })
      }
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'inherit', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'color-mix(in srgb, currentColor 40%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.dsh-editor-flash': { backgroundColor: 'color-mix(in srgb, #f5a623 30%, transparent)', transition: 'background-color 0.6s' },
})

const STYLE = `
.dsh-text-engine { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-text-engine__bar { display: flex; justify-content: flex-end; gap: 4px; padding: 2px 8px; }
.dsh-text-engine__bar button { font: inherit; font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; color: inherit; cursor: pointer; }
.dsh-text-engine__bar button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-text-engine__body { flex: 1; min-height: 0; overflow: hidden; }
.dsh-text-engine__body [hidden] { display: none; }
.dsh-text-engine__preview { height: 100%; overflow: auto; padding: 12px 20px; line-height: 1.6; }
.dsh-text-engine__preview img { max-width: 100%; }
.dsh-text-engine__preview pre { overflow: auto; padding: 8px; background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 4px; }
`

function ensureStyle(document: Document): void {
  if (document.querySelector('style[data-dsh-text-engine]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshTextEngine = ''
  style.textContent = STYLE
  document.head.appendChild(style)
}

/** Disk text in CodeMirror's coordinates, where every line break is one position. */
const normalize = (text: string): string => text.replace(/\r\n/g, '\n')

function mount(host: HTMLElement, binding: EngineBinding): EngineInstance {
  const document = host.ownerDocument
  ensureStyle(document)
  const root = document.createElement('div')
  root.className = 'dsh-text-engine'
  const body = document.createElement('div')
  body.className = 'dsh-text-engine__body'
  const preview = document.createElement('div')
  preview.className = 'dsh-text-engine__preview'
  preview.hidden = true
  // CodeMirror owns its root element's attributes, so visibility is toggled on a wrapper.
  const source = document.createElement('div')
  source.style.height = '100%'

  let viewTimer: ReturnType<typeof setTimeout> | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  let selectionTimer: ReturnType<typeof setTimeout> | undefined
  const reportSelection = (delayMs: number): void => {
    clearTimeout(selectionTimer)
    selectionTimer = setTimeout(() => {
      const state = view.state
      const { from, to, head } = state.selection.main
      binding.onSelection({
        cursorLine: state.doc.lineAt(head).number,
        fromLine: state.doc.lineAt(from).number,
        toLine: state.doc.lineAt(to).number,
        text: state.sliceDoc(from, to),
      })
    }, delayMs)
  }
  const reportView = (): void => {
    clearTimeout(viewTimer)
    viewTimer = setTimeout(() => {
      const { anchor, head } = view.state.selection.main
      binding.onViewChange({ anchor, head, scrollTop: view.scrollDOM.scrollTop })
    }, 300)
  }

  const view = new EditorView({
    parent: source,
    state: EditorState.create({
      doc: binding.initialText,
      extensions: [
        EditorState.lineSeparator.of(binding.lineSeparator),
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        languageFor(binding.extension),
        flashField,
        theme,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { binding.save(); return true } },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(tr => tr.annotation(Transaction.remote) === true)) {
            // sliceDoc joins lines with the configured separator; doc.toString() always uses "\n".
            binding.onLocalChange(update.state.sliceDoc())
          }
          if (update.selectionSet || update.docChanged) {
            reportView()
            if (update.view.hasFocus) reportSelection(150)
          }
        }),
        EditorView.domEventHandlers({
          scroll: () => { reportView() },
          focus: () => { reportSelection(0) },
          blur: () => { binding.onBlur() },
        }),
      ],
    }),
  })

  const initial = binding.initialView
  if (initial !== undefined) {
    const length = view.state.doc.length
    view.dispatch({ selection: EditorSelection.single(Math.min(initial.anchor, length), Math.min(initial.head, length)) })
    requestAnimationFrame(() => { view.scrollDOM.scrollTop = initial.scrollTop })
  }

  // A freshly opened file is what the user is looking at: tell the AI right away.
  reportSelection(0)

  root.append(...MARKDOWN.includes(binding.extension) ? [toolbar()] : [], body)
  body.append(source, preview)
  host.append(root)

  function toolbar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'dsh-text-engine__bar'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Preview'
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      const showing = preview.hidden
      if (showing) renderPreview()
      preview.hidden = !showing
      source.hidden = showing
      button.setAttribute('aria-pressed', String(showing))
      button.textContent = showing ? 'Source' : 'Preview'
      if (!showing) view.focus()
    })
    bar.append(button)
    return bar
  }

  function renderPreview(): void {
    // Workspace files are untrusted: sanitize the rendered HTML.
    preview.innerHTML = DOMPurify.sanitize(marked.parse(view.state.doc.toString(), { async: false }))
  }

  return {
    applyExternal(text) {
      // Diff with both sides "\n"-joined, so offsets match CodeMirror positions;
      // the insert goes back to the file's separator, the only one the state splits on.
      const changes = diffText(view.state.doc.toString(), normalize(text))
        .map(change => ({ ...change, insert: view.state.toText(change.insert.replace(/\n/g, binding.lineSeparator)) }))
      if (changes.length === 0) return
      const [change] = changes
      view.dispatch({
        changes,
        annotations: Transaction.remote.of(true),
        effects: addFlash.of({ from: change!.from, to: change!.from + change!.insert.length }),
      })
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => view.dispatch({ effects: clearFlash.of(null) }), FLASH_MS)
      if (!preview.hidden) renderPreview()
    },
    focus() {
      view.focus()
    },
    destroy() {
      clearTimeout(viewTimer)
      clearTimeout(flashTimer)
      clearTimeout(selectionTimer)
      view.destroy()
      root.remove()
    },
  }
}

export const textEngine: EditorEngine = {
  id: 'text',
  extensions: [...MARKDOWN, ...PYTHON, ...PLAIN],
  mount,
}

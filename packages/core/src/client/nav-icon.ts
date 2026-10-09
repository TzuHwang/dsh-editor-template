/**
 * A document icon for the editor's entry in DSH's settings navigation.
 *
 * DSH 0.2 picks settings nav icons from a fixed table of its own section ids
 * and gives every other section a gear; there is no option for a plugin's
 * icon. So while the settings dialog is open, this finds the nav button whose
 * label is the editor's and swaps its icon. It depends on DSH's markup, not an
 * API: when the markup changes, the button keeps DSH's gear and nothing else
 * breaks. The smoke test checks it, so a DSH upgrade that breaks it shows.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
/** DSH's medium icon stroke (ICON_MEDIUM_STROKE in ui-primitives). */
const STROKE = '1.3'
const MARK = 'data-dsh-editor-icon'

/** A page with a folded corner and two lines of text, drawn like DSH's outline icons. */
function documentIcon(document: Document, like: SVGElement): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const name of ['width', 'height', 'class']) {
    const value = like.getAttribute(name)
    if (value !== null) svg.setAttribute(name, value)
  }
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('stroke-width', STROKE)
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute(MARK, '')
  for (const d of [
    'M9.5 1.5H4C3.44772 1.5 3 1.94772 3 2.5V13.5C3 14.0523 3.44772 14.5 4 14.5H12C12.5523 14.5 13 14.0523 13 13.5V5L9.5 1.5Z',
    'M9.5 1.5V5H13',
    'M5.5 8.5H10.5',
    'M5.5 11H8.5',
  ]) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('stroke', 'currentColor')
    svg.append(path)
  }
  return svg
}

/** Swap the icon of the settings nav button labelled `label()`; returns the disposer. */
export function decorateSettingsNav(document: Document, label: () => string): () => void {
  let frame: number | undefined
  const apply = (): void => {
    frame = undefined
    const dialog = document.querySelector('[data-shortcut-modal="settings"]')
    if (dialog === null) return
    for (const button of dialog.querySelectorAll('nav button')) {
      if (button.textContent?.trim() !== label()) continue
      const icon = button.querySelector('svg')
      if (icon === null || icon.hasAttribute(MARK)) continue
      icon.replaceWith(documentIcon(document, icon))
    }
  }
  // Coalesce bursts of DOM changes into one pass per frame.
  const observer = new MutationObserver(() => { frame ??= requestAnimationFrame(apply) })
  observer.observe(document.body, { childList: true, subtree: true })
  apply()
  return () => {
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}

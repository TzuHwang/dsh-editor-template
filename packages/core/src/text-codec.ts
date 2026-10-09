/**
 * Byte-faithful text decoding. The paged `workspaceFiles.read` drops the final
 * newline, so the editor reads bytes and decodes them itself: what it writes
 * back must equal what it read when the user changed nothing.
 */

export interface DecodedText {
  /** The text, with a UTF-8 BOM kept as U+FEFF so it is written back. */
  readonly text: string
  readonly lineSeparator: '\n' | '\r\n'
}

/** Thrown for content that is not UTF-8 text; the engine must not open it. */
export class NotTextError extends Error {
  override readonly name = 'NotTextError'
}

export function decodeText(bytes: Uint8Array): DecodedText {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new NotTextError('not valid UTF-8', { cause })
  }
  if (text.includes('\0')) throw new NotTextError('contains NUL bytes')
  return { text, lineSeparator: detectLineSeparator(text) }
}

/** The file's line separator: CRLF when its first line break is CRLF. */
export function detectLineSeparator(text: string): '\n' | '\r\n' {
  const lf = text.indexOf('\n')
  return lf > 0 && text[lf - 1] === '\r' ? '\r\n' : '\n'
}

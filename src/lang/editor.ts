// A small, swappable CODE EDITOR controller so main.ts stays widget-agnostic. The
// textarea implementation here is the zero-dep baseline (the slice-1 POC); the
// CodeMirror implementation (highlighting + autocomplete + lint — piste A) lives in
// `editor-cm.ts` and exposes the SAME `CodeEditorHandle`, so swapping is one import.

export interface CodeEditorHandle {
  setValue: (src: string) => void
  getValue: () => string
  setReadOnly: (ro: boolean) => void
  /** Show an inline error (line/col optional) or clear it when null. */
  setError: (err: { message: string; line?: number; col?: number } | null) => void
}

/** Mount a plain `<textarea>` editor into `parent`. `onChange` fires on every edit. */
export function mountTextarea(
  parent: HTMLElement,
  errorEl: HTMLElement,
  onChange: (src: string) => void,
  placeholder = 'Engram.combat_turn:\n    return attack(senses.enemies.lowest_hp)',
): CodeEditorHandle {
  parent.replaceChildren()
  const ta = document.createElement('textarea')
  ta.className = 'code-editor'
  ta.spellcheck = false
  ta.setAttribute('autocomplete', 'off')
  ta.setAttribute('autocapitalize', 'off')
  ta.placeholder = placeholder
  ta.addEventListener('input', () => { onChange(ta.value); })
  // Tab inserts spaces instead of leaving the field (code-editor ergonomics).
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      ta.value = `${ta.value.slice(0, start)}    ${ta.value.slice(end)}`
      ta.selectionStart = start + 4
      ta.selectionEnd = start + 4
      onChange(ta.value)
    }
  })
  parent.appendChild(ta)
  const errBox = errorEl // a const alias: configuring the passed error element is the job

  return {
    setValue(src) { if (ta.value !== src) ta.value = src },
    getValue() { return ta.value },
    setReadOnly(ro) { ta.readOnly = ro; ta.classList.toggle('locked', ro) },
    setError(err) {
      if (err === null) { errBox.hidden = true; errBox.textContent = ''; return }
      const col = err.col === undefined ? '' : `, col ${err.col}`
      const where = err.line === undefined ? '' : ` (line ${err.line}${col})`
      errBox.hidden = false
      errBox.textContent = `⚠ ${err.message}${where}`
    },
  }
}

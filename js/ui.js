// ui.js — tiny DOM helpers. All text goes through textContent; innerHTML is never
// used for data, so imported or typed text can't inject markup.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') throw new Error('innerHTML is not allowed');
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) node.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (['checked', 'disabled', 'selected', 'required', 'open', 'readOnly', 'multiple', 'indeterminate'].includes(k)) node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Inline icon from the SVG sprite in index.html. */
export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function chip(text, tone = 'neutral') {
  return el('span', { class: `chip chip-${tone}`, text });
}

export function button(label, { onClick, variant = 'secondary', type = 'button', icon: iconName, disabled = false, ariaLabel, cls = '' } = {}) {
  const b = el('button', { type, class: `btn btn-${variant} ${cls}`.trim(), disabled, 'aria-label': ariaLabel, onclick: onClick });
  if (iconName) b.append(icon(iconName));
  b.append(el('span', { text: label }));
  return b;
}

let idCounter = 0;
export function uid(prefix = 'f') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function field(labelText, input, { hint, required } = {}) {
  if (!input.id) input.id = uid('field');
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { for: input.id, class: 'field-label' }, labelText, required ? el('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }) : null));
  wrap.append(input);
  if (hint) {
    const hintEl = el('p', { class: 'field-hint', id: uid('hint'), text: hint });
    input.setAttribute('aria-describedby', hintEl.id);
    wrap.append(hintEl);
  }
  return wrap;
}

/** Segmented single-choice control built from buttons (large tap targets). */
export function segmented(options, value, onChange, { label, name } = {}) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const api = { value, node: group };
  const render = () => {
    group.replaceChildren(
      ...options.map((o) =>
        el(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: `seg${api.value === o.id ? ' is-active' : ''}`,
            'aria-checked': String(api.value === o.id),
            'data-value': o.id,
            onclick: () => {
              api.value = o.id;
              render();
              onChange && onChange(o.id, o);
            },
          },
          o.label
        )
      )
    );
  };
  render();
  api.set = (v) => {
    api.value = v;
    render();
  };
  return api;
}

/** Vertical list of radio "cards" with a title, description and optional chip. */
export function radioCards(name, options, value, onChange) {
  const list = el('div', { class: 'radio-cards', role: 'radiogroup' });
  const api = { value, node: list };
  const render = () => {
    list.replaceChildren(
      ...options.map((o) => {
        const id = uid('rc');
        const input = el('input', { type: 'radio', name, id, value: o.id, checked: api.value === o.id, disabled: !!o.disabled, onchange: () => {
          api.value = o.id;
          render();
          onChange && onChange(o.id, o);
        } });
        return el(
          'label',
          { class: `radio-card${api.value === o.id ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`, for: id },
          input,
          el('span', { class: 'radio-card-body' }, el('span', { class: 'radio-card-title' }, o.label, o.chip ? chip(o.chip.text, o.chip.tone) : null), o.description ? el('span', { class: 'radio-card-desc', text: o.description }) : null, o.warning ? el('span', { class: 'radio-card-warning' }, icon('alert', 'icon icon-sm'), o.warning) : null)
        );
      })
    );
  };
  render();
  return api;
}

// ---------- Bottom sheet ----------
const sheetStack = [];

export function openSheet({ title, content, onClose, size = 'default', closeLabel = 'Close' }) {
  const root = document.getElementById('sheet-root');
  const previouslyFocused = document.activeElement;
  const titleId = uid('sheet-title');
  const panel = el('div', { class: `sheet sheet-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' });
  const body = el('div', { class: 'sheet-body' });
  const api = {
    panel,
    body,
    close(reason = 'close') {
      if (!wrap.isConnected) return;
      wrap.remove();
      const i = sheetStack.indexOf(api);
      if (i >= 0) sheetStack.splice(i, 1);
      if (!sheetStack.length) document.body.classList.remove('sheet-open');
      if (onClose) onClose(reason);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && previouslyFocused.isConnected) previouslyFocused.focus();
    },
    setContent(node) {
      body.replaceChildren(node);
      focusFirst();
    },
    setTitle(t) {
      heading.textContent = t;
    },
  };
  const heading = el('h2', { id: titleId, class: 'sheet-title', text: title });
  const header = el('div', { class: 'sheet-header' }, heading, el('button', { type: 'button', class: 'btn btn-ghost btn-icon sheet-close', 'aria-label': closeLabel, onclick: () => api.close('close') }, icon('close')));
  panel.append(header, body);
  append(body, [content]);
  const backdrop = el('div', { class: 'sheet-backdrop', onclick: () => api.close('backdrop') });
  const wrap = el('div', { class: 'sheet-wrap' }, backdrop, panel);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.close('escape');
    } else if (e.key === 'Tab') {
      const focusables = panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  root.append(wrap);
  document.body.classList.add('sheet-open');
  sheetStack.push(api);
  function focusFirst() {
    requestAnimationFrame(() => {
      const target = body.querySelector('input:not([type="hidden"]):not([disabled]), select, textarea, button:not([disabled])') || panel;
      target.focus({ preventScroll: true });
    });
  }
  focusFirst();
  return api;
}

export function closeAllSheets() {
  for (const s of [...sheetStack]) s.close('navigate');
}

/** In-page confirmation (window.confirm is not available in embedded viewers). */
export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, extra = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const sheet = openSheet({
      title,
      size: 'compact',
      onClose: () => done(false),
      content: el(
        'div',
        { class: 'confirm' },
        typeof message === 'string' ? el('p', { class: 'confirm-message', text: message }) : message,
        extra,
        el(
          'div',
          { class: 'btn-row' },
          button(cancelText, { variant: 'secondary', onClick: () => sheet.close('cancel') }),
          button(confirmText, {
            variant: danger ? 'danger' : 'primary',
            onClick: () => {
              done(true);
              sheet.close('confirm');
            },
          })
        )
      ),
    });
  });
}

// ---------- Toast ----------
let toastTimer = null;
export function toast(message, { duration = 3500 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.replaceChildren(el('div', { class: 'toast' }, icon('check', 'icon icon-sm'), el('span', { text: message })));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.replaceChildren(), duration);
}

/** Copy text; falls back to selecting a textarea when the clipboard is unavailable. */
export async function copyText(text, fallbackTextarea) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (fallbackTextarea) {
    fallbackTextarea.focus();
    fallbackTextarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
  return false;
}

/** Offer a download; silently no-ops where the viewer refuses downloads (Copy stays available). */
export function downloadText(filename, text, mime = 'application/json') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function escapeAttr(s) {
  return String(s).replace(/[^\w-]/g, '_');
}

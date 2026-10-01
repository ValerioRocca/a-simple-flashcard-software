// Small helpers for building the interface without a framework.

/**
 * Create an element: h('button', { class: 'btn', onclick: fn }, 'Save').
 * Children may be nodes, strings, arrays, or null/false (skipped).
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replace everything inside `el`. Takes the same kinds of children as `h`, so null is simply skipped. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
}

export const formatNumber = (n) => n.toLocaleString('en-GB');

// ---------------------------------------------------------------- toasts

let toastHost = null;

/** A short message near the top of the window that goes away by itself. */
export function toast(message, { kind = 'info', duration = 3500 } = {}) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  // A dialog sits in the browser's top layer: move the toasts into it to stay visible.
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  (dialog ?? document.body).append(toastHost);
  // One message at a time: a new one replaces the one still showing.
  const item = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.replaceChildren(item);
  setTimeout(() => item.remove(), duration);
}

/** Show an unexpected error to the user instead of failing silently. */
export function reportError(error, context = '') {
  console.error(error);
  const message = error?.message || String(error);
  toast(context ? `${context}: ${message}` : message, { kind: 'error', duration: 7000 });
}

// ---------------------------------------------------------------- dialogs

/**
 * Open a modal dialog. `buttons(close)` returns the footer buttons; whatever is
 * passed to `close` is what the returned promise resolves to (undefined when
 * the dialog is dismissed with Esc).
 */
export function showDialog({ title, content, buttons, wide = false, dismissible = true, onOpen = null }) {
  return new Promise((resolve) => {
    let result;
    const dialog = h('dialog', { class: `dialog${wide ? ' dialog-wide' : ''}` });
    const close = (value) => {
      result = value;
      dialog.close();
    };
    dialog.append(
      h('h2', { class: 'dialog-title' }, title),
      h('div', { class: 'dialog-body' }, content),
      h('div', { class: 'dialog-actions' }, buttons(close)),
    );
    dialog.addEventListener('cancel', (event) => {
      if (!dismissible) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    onOpen?.(dialog, close);
  });
}

function paragraphs(message) {
  return [].concat(message).map((part) => (part instanceof Node ? part : h('p', null, part)));
}

export function alertDialog({ title, message, closeLabel = 'OK' }) {
  return showDialog({
    title,
    content: paragraphs(message),
    buttons: (close) => [h('button', { class: 'btn btn-primary', type: 'button', autofocus: true, onclick: () => close() }, closeLabel)],
  });
}

/** Resolves to true only when the user confirms. */
export async function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const result = await showDialog({
    title,
    content: paragraphs(message),
    buttons: (close) => [
      h('button', { class: 'btn', type: 'button', autofocus: danger, onclick: () => close(false) }, cancelLabel),
      h('button', {
        class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', autofocus: !danger, onclick: () => close(true),
      }, confirmLabel),
    ],
  });
  return result === true;
}

/**
 * Ask for one line of text. `check(value)` may throw an Error whose message is
 * shown under the field. Resolves to the text, or null when cancelled.
 */
export async function promptDialog({ title, label, value = '', confirmLabel = 'OK', check = null }) {
  const input = h('input', { class: 'input', type: 'text', value, autocomplete: 'off' });
  const error = h('p', { class: 'field-error', hidden: true });
  let closeDialog;
  const submit = () => {
    try {
      const text = input.value.trim();
      check?.(text);
      closeDialog(text);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      input.focus();
    }
  };
  const form = h('form', { onsubmit: (event) => { event.preventDefault(); submit(); } },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
    error,
  );
  const result = await showDialog({
    title,
    content: form,
    buttons: (close) => {
      closeDialog = close;
      return [
        h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, confirmLabel),
      ];
    },
    onOpen: () => {
      input.focus();
      input.select();
    },
  });
  return result ?? null;
}

// ---------------------------------------------------------------- menu

/** A button that opens a small menu. `items`: `{ label, action, danger }` or '-' for a divider. */
export function menuButton(label, items, { ariaLabel = 'More actions' } = {}) {
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const button = h('button', {
    class: 'btn btn-quiet', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': ariaLabel,
  }, label);
  const wrap = h('div', { class: 'menu-wrap' }, button, menu);

  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (event) => {
    if (!wrap.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  };
  button.addEventListener('click', () => {
    if (!menu.hidden) {
      close();
      return;
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });

  for (const item of items) {
    if (item === '-') {
      menu.append(h('div', { class: 'menu-divider' }));
      continue;
    }
    menu.append(h('button', {
      class: `menu-item${item.danger ? ' menu-item-danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        close();
        item.action();
      },
    }, item.label));
  }
  return wrap;
}

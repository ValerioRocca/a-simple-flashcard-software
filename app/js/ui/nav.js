/** Go to a screen, e.g. navigate('#/study/d_abc'). Going to the current one reloads it. */
export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** Tell the app shell that the data folder was opened, switched or closed. */
export function folderChanged() {
  window.dispatchEvent(new CustomEvent('app:folder-changed'));
}

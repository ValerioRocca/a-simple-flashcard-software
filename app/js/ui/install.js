// Installing the app from the browser (own window, taskbar and Start menu icon).

let promptEvent = null;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  promptEvent = event;
  notify();
});

window.addEventListener('appinstalled', () => {
  promptEvent = null;
  notify();
});

/** True when the browser is ready to install the app on request. */
export const canInstall = () => promptEvent !== null;

/** True when running in the installed app's own window. */
export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches;

/** Show the browser's install dialog. Must be called from a click. */
export async function install() {
  if (!promptEvent) return false;
  const event = promptEvent;
  promptEvent = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === 'accepted';
}

export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

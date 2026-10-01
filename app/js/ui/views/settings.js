// Settings: default daily limits, scheduling, the data folder, installing the app.

import { FSRSVersion } from '../../../vendor/ts-fsrs/ts-fsrs.mjs';
import { LIMITS, parseSteps, updateSettings } from '../../core/collection.js';
import { formatDateTime } from '../../core/time.js';
import { store } from '../../store.js';
import { APP_VERSION } from '../../version.js';
import { h, plural, reportError, setChildren } from '../dom.js';
import { canInstall, install, isInstalled, onInstallChange } from '../install.js';
import { folderChanged } from '../nav.js';
import { closeFolder, pickFolder } from '../open-folder.js';

/**
 * A field that saves as soon as its value is committed. `read(text)` returns
 * the settings to change, or throws an Error whose message is shown.
 */
function settingField({ label, help, input, read }) {
  const error = h('p', { class: 'field-error', hidden: true });
  input.addEventListener('change', () => {
    try {
      const patch = read(input.value.trim());
      store.change((col) => updateSettings(col, patch));
      error.hidden = true;
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  });
  return h('div', { class: 'setting' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input),
    help ? h('p', { class: 'muted setting-help' }, help) : null,
    error);
}

function wholeNumber(text, min, max, what) {
  const value = Number(text);
  if (text === '' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${what}: enter a whole number between ${min} and ${max}.`);
  }
  return value;
}

function steps(text, what) {
  const parsed = parseSteps(text);
  if (!parsed) throw new Error(`${what}: write steps like “1m 10m” (m = minutes, h = hours, d = days).`);
  return parsed;
}

const numberInput = (value, min, max) => h('input', {
  class: 'input input-number', type: 'number', min, max, step: 1, inputMode: 'numeric', value,
});
const textInput = (value) => h('input', { class: 'input input-short', type: 'text', value, autocomplete: 'off', spellcheck: false });

export function mount(host) {
  const { settings } = store.col;
  const percent = (share) => Math.round(share * 100);
  const minRetention = percent(LIMITS.retentionMin);
  const maxRetention = percent(LIMITS.retentionMax);

  const limits = h('section', { class: 'panel' },
    h('h2', null, 'Daily limits'),
    h('p', { class: 'muted' }, 'The defaults for every deck. A deck can have its own: Decks → ⋯ → Daily limits.'),
    h('div', { class: 'setting-row' },
      settingField({
        label: 'New cards per day',
        input: numberInput(settings.newPerDay, 0, LIMITS.perDayMax),
        read: (text) => ({ newPerDay: wholeNumber(text, 0, LIMITS.perDayMax, 'New cards per day') }),
      }),
      settingField({
        label: 'Reviews per day',
        input: numberInput(settings.reviewsPerDay, 0, LIMITS.perDayMax),
        read: (text) => ({ reviewsPerDay: wholeNumber(text, 0, LIMITS.perDayMax, 'Reviews per day') }),
      })));

  const scheduling = h('section', { class: 'panel' },
    h('h2', null, 'Scheduling'),
    settingField({
      label: 'Target retention (%)',
      help: `The share of cards you want to still remember when they come back. Higher means shorter intervals and more reviews; ${percent(0.9)}% is the usual choice. A change applies to each card from its next review.`,
      input: numberInput(percent(settings.desiredRetention), minRetention, maxRetention),
      read: (text) => ({ desiredRetention: wholeNumber(text, minRetention, maxRetention, 'Target retention') / 100 }),
    }),
    h('div', { class: 'setting-row' },
      settingField({
        label: 'Learning steps',
        help: 'Delays a new card goes through before it gets day-long intervals. “Again” returns it to the first step.',
        input: textInput(settings.learningSteps.join(' ')),
        read: (text) => ({ learningSteps: steps(text, 'Learning steps') }),
      }),
      settingField({
        label: 'Relearning steps',
        help: 'Delays for a card you had learned and then forgot.',
        input: textInput(settings.relearningSteps.join(' ')),
        read: (text) => ({ relearningSteps: steps(text, 'Relearning steps') }),
      })),
    h('p', { class: 'muted' }, 'Steps are written like “1m 10m”: m = minutes, h = hours, d = days. A new study day starts at 04:00.'));

  const backupLine = h('p');
  const drawBackup = () => {
    if (store.backupError) {
      setChildren(backupLine, h('span', { class: 'field-error' }, `The last backup failed: ${store.backupError.message}`));
    } else if (store.lastBackup) {
      setChildren(backupLine,
        `Last backup: ${formatDateTime(store.lastBackup.time)}. ${plural(store.backupCount, 'backup')} kept in the “backups” folder (one a day, the newest seven).`);
    } else {
      setChildren(backupLine, 'No backup yet.');
    }
  };
  drawBackup();

  const withFolderChange = (action) => async (event) => {
    const button = event.currentTarget;
    const before = store.dir;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
      if (store.dir !== before) folderChanged();
    }
  };

  const folder = h('section', { class: 'panel' },
    h('h2', null, 'Data folder'),
    h('p', null, 'Your cards are in the folder “', h('strong', null, store.dir.name), '” on this computer: ',
      h('code', null, 'data.json'), ', pictures in ', h('code', null, 'images'), ', backups in ', h('code', null, 'backups'), '.'),
    backupLine,
    h('p', { class: 'muted' }, 'To go back to an earlier day, close the app and copy a file from “backups” over data.json. The browser keeps only a pointer to this folder, never its contents.'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onclick: withFolderChange(() => pickFolder('open')) }, 'Switch to another folder…'),
      h('button', { class: 'btn', type: 'button', onclick: withFolderChange(closeFolder) }, 'Close this folder')));

  const installBox = h('div');
  const drawInstall = () => {
    if (isInstalled()) {
      setChildren(installBox, h('p', null, 'You are using the installed app.'));
    } else if (canInstall()) {
      setChildren(installBox,
        h('p', null, 'Install the app to give it its own window and an icon on the taskbar and in the Start menu.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => install() }, 'Install app'));
    } else {
      setChildren(installBox, h('p', null,
        'To give the app its own window and icon: in Edge, open the ⋯ menu → Apps → Install this site as an app.'));
    }
  };
  drawInstall();

  setChildren(host,
    h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
    limits,
    scheduling,
    folder,
    h('section', { class: 'panel' }, h('h2', null, 'Install'), installBox),
    h('section', { class: 'panel' },
      h('h2', null, 'About'),
      h('p', { class: 'muted' },
        `Flashcards ${APP_VERSION}. Scheduler: ts-fsrs ${FSRSVersion}. `,
        'Also uses marked, DOMPurify and KaTeX. All four are open source and included with the app; their licences are in app/vendor.'),
      h('p', { class: 'muted' },
        h('a', { href: 'tests/' }, 'Run the built-in tests'),
        ' to check that everything works in this browser. They use a scratch area of their own and never touch your data folder.')),
  );

  const offInstall = onInstallChange(drawInstall);
  const offStatus = store.on('status', drawBackup);
  return () => {
    offInstall();
    offStatus();
  };
}

// Statistics: what was studied today, and how many cards come due in the next 30 days.

import { forecast, todaySummary } from '../../core/stats.js';
import { dateOfDayIndex, formatDuration } from '../../core/time.js';
import { store } from '../../store.js';
import { formatNumber, h, plural, setChildren } from '../dom.js';

const DAYS = 30;
const DAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

// The deck filter is kept while moving between screens.
let chosenDeck = '';

/** Axis ticks at round numbers: about four steps, never fractions of a card. */
function axisTicks(max) {
  const rough = Math.max(1, max) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { top, ticks };
}

function tile(label, value, detail = '') {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    detail ? h('div', { class: 'tile-detail' }, detail) : null);
}

function todayTiles(today) {
  if (!today.reviews) {
    return h('p', { class: 'muted' }, 'Nothing studied yet today.');
  }
  return h('div', { class: 'tiles' },
    tile('Reviews', formatNumber(today.reviews), `of ${plural(today.cards, 'card')}`),
    tile('Time spent', formatDuration(today.ms), `${(today.ms / today.reviews / 1000).toFixed(1)} s per review`),
    tile('Correct', `${Math.round(today.correctShare * 100)}%`, `${formatNumber(today.correct)} of ${formatNumber(today.reviews)}`),
  );
}

function forecastChart({ today, counts, overdue }) {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    return h('p', { class: 'muted' },
      'No cards are due in the next 30 days. A card appears here once it has been studied for the first time.');
  }

  const max = Math.max(...counts);
  const peak = counts.indexOf(max);
  const { top, ticks } = axisTicks(max);
  const days = counts.map((count, offset) => {
    const date = dateOfDayIndex(today + offset);
    return {
      count,
      offset,
      name: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : DAY_LONG.format(date),
      short: offset === 0 ? 'Today' : DAY_SHORT.format(date),
    };
  });
  const describe = (day) => `${plural(day.count, 'card')} due${day.offset === 0 && overdue ? `, ${formatNumber(overdue)} of them overdue` : ''}`;

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const area = h('div', { class: 'chart-area' });

  const showTip = (day, column) => {
    setChildren(tip,
      h('div', { class: 'chart-tip-value' }, describe(day)),
      h('div', { class: 'chart-tip-label' }, day.name));
    tip.hidden = false;
    const centre = column.offsetLeft + column.offsetWidth / 2;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(centre, half), area.clientWidth - half)}px`;
    tip.style.bottom = `calc(${(day.count / top) * 100}% + 24px)`;
  };

  const columns = days.map((day) => {
    // The whole column is the hover target, not just the bar.
    const column = h('div', {
      class: 'chart-col',
      tabIndex: 0,
      role: 'img',
      'aria-label': `${day.name}: ${describe(day)}`,
    },
    // Only today and the busiest day carry their number; the rest is read off the axis.
    (day.offset === 0 || day.offset === peak) && day.count > 0
      ? h('span', { class: 'chart-value' }, formatNumber(day.count))
      : null,
    day.count > 0 ? h('div', { class: 'chart-bar', style: `height: ${(day.count / top) * 100}%` }) : null);
    column.addEventListener('pointerenter', () => showTip(day, column));
    column.addEventListener('focus', () => showTip(day, column));
    column.addEventListener('pointerleave', () => { tip.hidden = true; });
    column.addEventListener('blur', () => { tip.hidden = true; });
    return column;
  });

  setChildren(area,
    ticks.filter((value) => value > 0)
      .map((value) => h('div', { class: 'chart-gridline', style: `bottom: ${(value / top) * 100}%` })),
    h('div', { class: 'chart-cols' }, columns),
    tip,
  );

  const yAxis = h('div', { class: 'chart-yaxis', 'aria-hidden': 'true' },
    h('span', { class: 'chart-ysizer' }, formatNumber(top)),
    ticks.map((value) => h('span', { class: 'chart-ytick', style: `bottom: ${(value / top) * 100}%` }, formatNumber(value))));

  const xAxis = h('div', { class: 'chart-xaxis', 'aria-hidden': 'true' },
    days.map((day) => h('div', { class: 'chart-xcell' },
      day.offset % 7 === 0 ? h('span', { class: 'chart-xlabel' }, day.short) : null)));

  const busiest = days[peak];
  return h('div', null,
    h('p', { class: 'muted chart-summary' },
      `${plural(total, 'card')} in all`,
      overdue ? `, ${formatNumber(overdue)} already overdue` : '',
      `. Busiest day: ${busiest.name.toLowerCase() === 'today' ? 'today' : busiest.name} (${formatNumber(busiest.count)}).`),
    h('div', { class: 'chart-frame' }, yAxis, area, h('div'), xAxis),
    h('details', { class: 'chart-table' },
      h('summary', null, 'Show as a table'),
      h('table', { class: 'table table-compact' },
        h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', { class: 'num' }, 'Cards due'))),
        h('tbody', null, days.map((day) => h('tr', null,
          h('td', null, day.name),
          h('td', { class: 'num' }, formatNumber(day.count))))))),
  );
}

export function mount(host) {
  const render = () => {
    const { col } = store;
    if (chosenDeck && !col.decks.has(chosenDeck)) chosenDeck = '';
    const deckId = chosenDeck || null;

    const select = h('select', { class: 'input select', 'aria-label': 'Deck' },
      h('option', { value: '' }, 'All decks'),
      [...col.decks.values()].map((deck) => h('option', { value: deck.id }, deck.name)));
    select.value = chosenDeck;
    select.addEventListener('change', () => {
      chosenDeck = select.value;
      render();
    });

    setChildren(host,
      h('div', { class: 'page-head' }, h('h1', null, 'Statistics')),
      h('div', { class: 'filters' }, h('label', { class: 'field field-inline' }, h('span', { class: 'field-label' }, 'Deck'), select)),
      h('section', { class: 'panel' },
        h('h2', null, 'Today'),
        todayTiles(todaySummary(col, new Date(), { deckId }))),
      h('section', { class: 'panel' },
        h('h2', null, 'Cards due over the next 30 days'),
        forecastChart(forecast(col, new Date(), { days: DAYS, deckId })),
        h('p', { class: 'muted chart-note' },
          'Counts cards already studied at least once, on the day they come back. New cards are not included: they are added by the daily limit.')),
    );
  };

  render();
  return store.on('change', render);
}

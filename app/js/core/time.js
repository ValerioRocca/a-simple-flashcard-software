// A study day starts at 04:00 local time, as in Anki, so that reviewing after
// midnight still counts for the previous day.
export const DAY_START_HOUR = 4;

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

export function iso(value) {
  return toDate(value).toISOString();
}

/** Number identifying the study day that contains `date`; consecutive days differ by 1. */
export function dayIndex(date) {
  const d = toDate(date);
  const day = d.getHours() < DAY_START_HOUR ? d.getDate() - 1 : d.getDate();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), day) / DAY);
}

/** The 04:00 boundary that opens the study day containing `date`. */
export function dayStart(date) {
  const d = toDate(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR);
  if (d.getHours() < DAY_START_HOUR) start.setDate(start.getDate() - 1);
  return start;
}

export function nextDayStart(date) {
  const start = dayStart(date);
  start.setDate(start.getDate() + 1);
  return start;
}

/** Local calendar date (at midnight) of a study day index. */
export function dateOfDayIndex(index) {
  const utc = new Date(index * DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function trimZero(text) {
  return text.replace(/\.0$/, '');
}

/** Short interval label as shown on the grade buttons: `<1m`, `10m`, `2h`, `4d`, `1.2mo`, `1.5y`. */
export function formatMinutes(minutes) {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${trimZero((minutes / 60).toFixed(1))}h`;
  return formatDays(minutes / 1440);
}

export function formatDays(days) {
  if (days < 1) return formatMinutes(days * 1440);
  if (days < 31) return `${Math.round(days)}d`;
  if (days < 365) return `${trimZero((days / 30.44).toFixed(1))}mo`;
  return `${trimZero((days / 365.25).toFixed(1))}y`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const formatDate = (value) => DATE_FORMAT.format(toDate(value));
export const formatTime = (value) => TIME_FORMAT.format(toDate(value));
export const formatDateTime = (value) => DATE_TIME_FORMAT.format(toDate(value));

/** Duration in a sentence: `45 s`, `12 min`, `1 h 05 min`. */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

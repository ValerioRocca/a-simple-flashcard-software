# Flashcard webapp — requirements

The list of features, inspired by Anki, with the decisions taken.

**Built so far:** every item tagged MVP (version 1.0.0, 1 October 2026). Items tagged Later are not built yet. One MVP item still needs a check that only the Windows laptop can give: K1, running the app in Edge on Windows.

**Status of each item:**

- `[x]` — approved. The tag says when it is built.
- `[ ]` — not decided yet (none at the moment).
- ~~struck through~~ — not to be built, with the reason stated: refused, skipped, or superseded by another item.

**Tags:**

- **MVP** — built in the first working version
- **Later** — built after the first version

Target: Microsoft Edge on Windows.

## Decisions

Resolved:

- Data lives in one folder on the PC's disk, with no copy in the browser: a JSON data file, an image folder and a backup folder (A1).
- Images are stored as files in the image folder, not inside the JSON (D3).
- Backups: a dated copy every 24 hours, last 7 kept, in the backup folder inside the data folder (A11).
- Scheduler: FSRS (F1). SM-2 is not offered (F2).
- Anki compatibility: importing Anki decks is approved for later (H4), so the JSON format keeps Anki's split between a note and the cards generated from it. Basic-and-reversed cards (C2) need that split anyway.
- `## subtopic` headings and `**Note:**` lines: kept in the data file on import but not shown until tags (C7) and the note field (C9) are built, so nothing is lost (H2, H6).
- Cards can be added both through the document editor (D8) and through a quick one-card form (D12).

- Delivery: the app is a GitHub repository, cloned on the Windows laptop and served there by a small local web server (A12–A15). Nothing is hosted online.
- Python is installed on the Windows laptop, so the start script uses it (A13).

Settled while building:

- The app is served at `http://localhost:8372/`. Port 8765 is avoided because AnkiConnect uses it whenever Anki is running.
- The mark for a reversed card in the Markdown format is the line `**Reversed:** yes` (C2).
- The installed app keeps a copy of its own files, so it also opens when the local server is not running; the server is needed for the first start and after an update (A2).
- Besides `**Q:**` and `**A:**`, the plain forms `Q:` and `A:` are accepted, to make typing during a presentation quicker (D9).

## A. Platform and data storage

- [x] **A1 · MVP** — All data lives in one folder on the PC's disk, at a location you choose: a JSON data file, an image folder and a backup folder. The app reads and writes there directly; no copy of decks, cards or review history is kept in the browser. No server, no account, works offline.
- [x] **A2 · MVP** — Installable from Edge as an app: own window, taskbar and Start menu icon. Installed from the local address served in A12.
- ~~**A3** — Manual backup and restore to a single file.~~ Superseded by A1 and A11.
- ~~**A4** — Automatic dated backup copies of the data file, in a folder next to it.~~ Superseded by A11.
- ~~**A5** — Account and cloud sync across devices (requires a server).~~ Skipped. Keeping the data folder inside OneDrive already syncs it between PCs.
- ~~**A6** — Multiple user profiles on the same PC.~~ Skipped. Each person can simply use a separate data folder.
- [x] **A7 · MVP** — On start, the app asks you to open an existing data folder or create a new one.
- [x] **A8 · MVP** — Every change is written to the data file immediately; there is no Save button.
- [x] **A9 · MVP** — The app remembers which data folder was used last, so reopening takes one click. Only a pointer to the folder is kept in the browser, never its contents, and Edge may ask you to confirm access again.
- [x] **A10 · MVP** — Warning when the data file was changed outside the app, or is open in a second tab, instead of silently overwriting it.
- [x] **A11 · MVP** — Automatic backup: every 24 hours a dated copy of the JSON data file is written to the backup folder inside the data folder, and the last 7 copies are kept. A webapp cannot run while it is closed, so the backup is made as soon as the app is open and the last one is more than 24 hours old. Images are not copied, because the app never changes an image once it is stored. These backups protect against a damaged or wrongly edited data file, not against losing the disk; keeping the data folder inside OneDrive covers that.
- [x] **A12 · MVP** — Local delivery: the app lives in a GitHub repository that you clone on the Windows laptop, and a small web server on that laptop serves it to Edge at `http://localhost:8372/`. Updating the app is a `git pull`.
- [x] **A13 · MVP** — One-step start: double-clicking a start script launches the local server and opens the app in Edge. The server is Python's built-in one, so Python must be installed on the laptop.
- [x] **A14 · MVP** — No build step on the laptop: the repository holds the app ready to serve, and every library it uses (scheduler, maths rendering) is included in the repository instead of being downloaded when the app runs.
- [x] **A15 · MVP** — Personal data stays out of the repository: the data folder is chosen outside the clone, and the app warns if you pick a folder inside it, so cards are never pushed to GitHub.

## B. Decks

- [x] **B1 · MVP** — Create, rename and delete decks.
- [x] **B2 · Later** — Nested sub-decks; studying a parent includes its children.
- [x] **B3 · MVP** — Deck list showing, per deck, how many cards are new, in learning, and due today.
- [x] **B4 · MVP** — Per-deck daily limits: for each deck, raise or lower the number of new cards to study and the number of cards to review per day. No other per-deck settings.
- [x] **B5 · Later** — Custom study session: review ahead, cram a tag, or re-study today's forgotten cards without changing the schedule.

## C. Cards and note types

- [x] **C1 · MVP** — Basic card: front and back.
- [x] **C2 · MVP** — Basic and reversed: one entry produces two cards (front→back and back→front). Needs a marker in the Markdown Q&A format.
- [x] **C3 · Later** — Cloze deletion: hide parts of a sentence, one card per hidden part.
- [x] **C4 · Later** — Type-in-the-answer cards, with your answer compared against the correct one.
- ~~**C5** — Custom note types with arbitrary fields and HTML/CSS templates.~~ Skipped.
- ~~**C6** — Image occlusion: mask regions of an image.~~ Skipped.
- [x] **C7 · Later** — Tags on cards.
- [x] **C8 · Later** — Duplicate warning when adding a card whose front already exists.
- [x] **C9 · Later** — Optional "note" field shown under the answer (extra context, source, mnemonic).

## D. Card content and authoring

- [x] **D1 · MVP** — Basic formatting written as Markdown: bold, italic, lists, links.
- [x] **D2 · Later** — Rich-text editor with a toolbar instead of typing Markdown.
- [x] **D3 · MVP** — Images: paste from the clipboard or drag in. Stored as files in the image folder inside the data folder.
- [x] **D4 · MVP** — Math formulas written in LaTeX.
- [x] **D5 · Later** — Code blocks with syntax highlighting.
- [x] **D6 · Later** — Audio clips on cards.
- [x] **D7 · Later** — Text-to-speech using Edge's built-in voices.
- [x] **D8 · MVP** — Card editor as a split view: on the left, a Markdown document holding any number of cards in the Q&A format; on the right, a live preview of the cards it will produce. The same view, holding one card, is used to edit an existing card.
- [x] **D9 · MVP** — Draft workflow: write the Q&A document anywhere (e.g. in a text editor during a presentation), open or paste it into the editor later, review and correct it against the preview, then add all its cards to a chosen deck in one step. The app offers an empty template of the document to start from.
- [x] **D10 · MVP** — The preview flags entries that cannot become a card (a question with no answer, an unrecognised line) before anything is imported.
- [x] **D11 · MVP** — The editor can save a corrected draft back to its `.md` file, so a draft can be finished over several sittings. Because nothing is kept in the browser (A1), an unsaved draft is otherwise lost when the tab closes.
- [x] **D12 · MVP** — Quick one-card form, as in Anki: pick a deck, type front and back, add; the form clears for the next card.

## E. Review session

- [x] **E1 · MVP** — Study a deck: show the front, reveal the answer, grade yourself.
- [x] **E2 · MVP** — Four grades (Again / Hard / Good / Easy), each button showing when the card would come back.
- [x] **E3 · MVP** — Keyboard shortcuts: Space to reveal, 1–4 to grade.
- [x] **E4 · MVP** — Undo the last answer.
- [x] **E5 · MVP** — Edit the current card without leaving the session.
- [x] **E6 · MVP** — Suspend a card: exclude it from review until re-enabled.
- [x] **E7 · Later** — Bury a card: hide it until tomorrow. Includes automatically burying the reversed twin of a card just seen.
- [x] **E8 · Later** — Coloured flags to mark cards for later attention.
- [x] **E9 · MVP** — Remaining counts during the session and a "done for today" screen.
- [x] **E10 · Later** — Timer per card.

## F. Scheduling

- [x] **F1 · MVP** — Spaced-repetition scheduler using FSRS.
- ~~**F2** — SM-2 as a selectable alternative.~~ Skipped.
- [x] **F3 · MVP** — Learning steps for new and forgotten cards (e.g. 1 min, then 10 min) before they move to day-long intervals.
- [x] **F4 · MVP** — Default daily limits: new cards per day and maximum reviews per day. B4 adjusts these per deck.
- [x] **F5 · MVP** — Target retention setting (e.g. 90%), which makes intervals shorter or longer.
- [x] **F6 · Later** — Configurable start of the study day (Anki uses 4 am; the MVP fixes it there).
- [x] **F7 · Later** — Leech handling: automatically tag or suspend cards failed many times.
- [x] **F8 · Later** — Manual rescheduling: reset a card to new, or set its due date.
- [x] **F9 · Later** — Tune the FSRS parameters to your own review history.
- [x] **F10 · Later** — Choice of new-card order: order added or random (the MVP uses order added).

## G. Card browser

- [x] **G1 · MVP** — Table of all cards with text search.
- [x] **G2 · MVP** — Filter by deck and state (new / learning / review / suspended); by tag once C7 is built.
- [x] **G3 · MVP** — Edit and delete cards from the browser.
- [x] **G4 · Later** — Bulk actions on selected cards: move deck, add or remove tag, suspend, delete.
- [x] **G5 · Later** — Anki-style search syntax (`deck:Statistics tag:bayes is:due`).
- [x] **G6 · Later** — Find and replace across cards.
- [x] **G7 · Later** — Sortable columns: due date, interval, created, difficulty.

## H. Import and export

- ~~**H1** — Import cards from CSV/TSV.~~ Refused.
- [x] **H2 · MVP** — Import cards from the Markdown Q&A format (`## subtopic` / `**Q:**` / `**A:**` / `**Note:**`), through the editor in D8, into a deck chosen at import time. Subtopic headings and note lines are kept in the data file but not shown until C7 and C9 are built.
- ~~**H3** — Export a deck to CSV.~~ Refused.
- [x] **H4 · Later** — Import Anki `.apkg` files: cards and media, optionally review history.
- ~~**H5** — Export to Anki `.apkg`.~~ Skipped.
- [x] **H6 · MVP** — Export a deck's cards to the Markdown Q&A format. Content only: Markdown carries no review history. Subtopics and notes kept at import are written back out.
- [x] **H7 · MVP** — Export a deck to, and import a deck from, a JSON file in the same format as the data file (A1), review history included.

## I. Statistics

- [x] **I1 · MVP** — Today's summary: cards reviewed, time spent, share answered correctly.
- [x] **I2 · MVP** — Forecast of reviews due over the next 30 days.
- [x] **I3 · Later** — Calendar heatmap of activity and current streak.
- [x] **I4 · Later** — Retention rate over time.
- [x] **I5 · Later** — Card counts by state (new / learning / young / mature).
- [x] **I6 · Later** — Review history for a single card.

## J. Interface

- [x] **J1 · MVP** — Light and dark theme, following the Windows setting.
- [x] **J2 · MVP** — Layout that adapts to the window size (desktop first).
- [x] **J3 · Later** — Phone-friendly layout.
- ~~**J4** — Everything reachable by keyboard.~~ Refused. The review shortcuts in E3 are a separate item.
- [x] **J5 · Later** — Daily reminder notification.
- ~~**J6** — Customisable keyboard shortcuts.~~ Skipped.
- ~~**J7** — Interface in languages other than English.~~ Skipped.

## K. Quality

- [x] **K1 · MVP** — Verified on the current version of Edge on Windows. Still to do: built and tested in Chrome on macOS, which shares Edge's engine; the check on the Windows laptop is open (README, "Checking that it works").
- [x] **K2 · MVP** — Stays responsive with at least 10,000 cards.
- [x] **K3 · MVP** — No requests to the internet at any time: the app is served locally (A12) with its libraries included (A14). No tracking.
- [x] **K4 · MVP** — Automated tests for the scheduler, for Markdown and JSON import and export, and for reading, writing and backing up the data file.
- [x] **K5 · MVP** — Confirmation before destructive actions (deleting a deck, deleting many cards).
- [x] **K6 · MVP** — README with the Windows steps: clone, start, install as an app, choose the data folder, update.

# Flashcards

A flashcard app with spaced repetition, inspired by Anki. It runs in Microsoft Edge on your own computer. Your cards are stored in a folder you choose on disk; nothing is kept in the browser or sent anywhere.

## What you need

- Windows with Microsoft Edge (Google Chrome also works)
- Python 3
- Git

## Set up on Windows

1. **Clone** the repository:

   ```
   git clone <the repository's address>
   ```

2. **Start** the app: double-click `start.bat` in the cloned folder. A small server starts in a minimised window named "Flashcards server", and the app opens in Edge at <http://localhost:8372/>.

3. **Choose the data folder.** Click **Create a new data folder** and pick (or create) a folder for your cards, for example `Documents\Flashcards`. Edge asks whether the site may edit files in it; allow it.
   - The folder must be **outside** the cloned folder, otherwise your cards could be pushed to GitHub. The app warns you if it is not.
   - Edge refuses a few system folders, such as `Documents` itself: use a folder inside it.
   - A folder inside OneDrive also gives you a copy off the PC.

4. **Install as an app** (optional): go to **Settings → Install app**, or in Edge open the **⋯** menu → **Apps** → **Install this site as an app**. The app then has its own window and an icon on the taskbar and in the Start menu. Once installed it also opens when the server is not running.

5. **Update** when there is a new version: run `git pull` in the cloned folder, then start the app once with `start.bat`.

To stop the server, close the "Flashcards server" window.

When you reopen the app, click **Continue with "…"**. Edge may ask you to confirm access to the folder again; choosing "Allow on every visit" avoids the question next time.

## Using it

| Screen | What it is for |
|---|---|
| **Decks** | Your decks with what is waiting today: new cards, cards in learning, cards due. **Study** starts a session. The **⋯** menu renames a deck, sets its daily limits, exports or deletes it. |
| **Add card** | A quick form for one card at a time. |
| **Card editor** | Write or paste many cards as one document, check them in the live preview, add them all to a deck. |
| **Browse** | Every card in a table: search, filter, edit, suspend, delete. |
| **Statistics** | What you studied today, and how many cards come due over the next 30 days. |
| **Settings** | Default daily limits, target retention, learning steps, the data folder, installing the app. |

While studying: **Space** shows the answer, **1–4** grade it (Again, Hard, Good, Easy). Each button shows when the card would come back. **Undo** takes back the last answer, **Edit** changes the card on the spot, **Suspend** takes it out of study until you resume it from Browse.

Every change is saved as you make it; there is no Save button. The top-right corner shows **Saved**.

## Writing cards as a document

The card editor reads a simple Markdown format. You can write such a document anywhere — in a text editor during a presentation, say — and open or paste it into the card editor later. **Template** gives you an empty one to fill in.

```markdown
## Hypothesis testing

**Q:** What is a p-value?
**A:** The probability, under the null hypothesis, of a result at least as
extreme as the one observed.

**Q:** Type I error
**A:** Rejecting a true null hypothesis
**Reversed:** yes

**Q:** What is the sample mean?
**A:** $$\bar{x} = \frac{1}{n}\sum_{i} x_i$$
```

- `**Q:**` starts a card's question and `**A:**` its answer. Both can span several lines. `Q:` and `A:` without the asterisks also work.
- `**Reversed:** yes` adds a second card that shows the answer and asks for the question.
- `## Heading` puts the cards below it under a subtopic. `**Note:**` adds a note to a card. Both are stored with the card but not shown yet.
- Markers count only at the start of a line, and never inside a ``` code block.
- Formulas are LaTeX: `$…$` in a sentence, `$$…$$` on their own line. `\(…\)`, `\[…\]` and `[$]…[/$]` work too.
- Text is Markdown: `**bold**`, `*italic*`, lists, links, `code`.
- Pictures: paste or drop them into the editor. They are saved in the data folder.

The preview marks anything that cannot become a card (a question without an answer, text outside a card), and cards are only added once nothing is marked. Blank `**Q:**`/`**A:**` pairs are ignored.

Drafts can be saved to and opened from `.md` files (**Save**, **Open file…**). A draft that is neither saved nor added to a deck is lost when you close the app; the app asks before that happens.

## Your data

The data folder contains:

| | |
|---|---|
| `data.json` | Decks, cards, their schedule and the review history. Plain text, one record per line. |
| `images/` | The pictures used on cards. |
| `backups/` | A dated copy of `data.json`, made once every 24 hours when the app is open. The newest seven are kept. |

**To go back to an earlier day:** close the app, then copy a file from `backups` over `data.json` (keep the name `data.json`).

Backups protect against a damaged or wrongly edited data file, not against losing the disk. Pictures are not part of the backups, because the app never changes a picture once it is stored.

If `data.json` is changed by something else while the app is open — another window, another program, a sync from another PC — the app notices, stops saving, and asks which version to keep instead of overwriting it. The same data folder cannot be opened in two tabs at once.

### Exporting and importing a deck

From a deck's **⋯** menu:

- **Export as Markdown** writes the deck in the format above. Content only: no schedule, no review history, and pictures stay in the data folder.
- **Export as JSON** writes the deck with its schedule, review history and pictures, in the same format as `data.json`.

**Import deck…** on the Decks screen reads such a JSON file (or a whole `data.json`). Imported decks are always added as new decks, renamed `Name (2)` if the name is taken; nothing existing is overwritten. To import Markdown, open the file in the card editor.

## How scheduling works

Cards are scheduled with [FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki), the algorithm also available in Anki. In short:

- A **new** card goes through the learning steps (1 minute, then 10 minutes by default) before it gets intervals in days.
- A card you forget goes through the relearning step (10 minutes) and comes back sooner afterwards.
- **Target retention** (90% by default) is the share of cards you want to still remember when they come back. Raising it shortens the intervals.
- **Daily limits** cap how many new cards and reviews a deck gives you per day (20 and 200 by default). Each deck can have its own.
- A study day starts at 04:00, so studying after midnight still counts for the day before.

## Checking that it works

Open <http://localhost:8372/tests/> (or **Settings → Run the built-in tests**). The page runs the app's tests in your browser. **Also test a folder on disk…** repeats the storage tests in a folder you pick, inside a scratch subfolder that is deleted afterwards.

The tests that need no browser also run with Node, if you have it: `node app/tests/run-node.mjs`.

## If something goes wrong

| Problem | What to do |
|---|---|
| `start.bat` says Python was not found | Install Python 3 from <https://www.python.org/downloads/> and run it again. |
| A box says port 8372 is used by another program | Close that program, or start the app on another port: `python serve.py --port 8373 --open`. On another port Edge treats the app as a different site: choose the data folder again, and install the app again if you had. |
| The page says the browser cannot open a folder | Use Microsoft Edge or Google Chrome on a desktop computer. |
| "Not saved" appears at the top | Click it. Usually Edge has withdrawn access to the folder, or the folder was moved or renamed. |
| "File changed elsewhere" appears at the top | Click it and choose which version to keep. |

On macOS or Linux, start the app with `python3 serve.py --open`.

## For developers

No build step and no dependencies to install: the app is plain HTML, CSS and JavaScript modules, served as they are.

```
serve.py            local web server (Python standard library only)
start.bat           starts the server and opens Edge
app/
  index.html
  sw.js             keeps a copy of the app's files, so the installed app opens without the server
  css/app.css
  js/core/          card format, data model, scheduler, statistics — no browser needed
  js/storage/       reading and writing the data folder
  js/store.js       the open collection: saving, conflict detection, backups
  js/ui/            screens and dialogs
  tests/            tests, runnable in the browser and in Node
  vendor/           third-party libraries, each with its licence
REQUIREMENTS.md     the agreed feature list, with what is planned for later
```

Third-party libraries, all included in `app/vendor`: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT), [marked](https://github.com/markedjs/marked) (MIT), [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 or MPL-2.0), [KaTeX](https://github.com/KaTeX/KaTeX) (MIT).

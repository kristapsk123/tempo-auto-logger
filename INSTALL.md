# Install Tempo Auto Logger (no coding required)

This guide is for teammates who just want to **install and use** the
extension. You don't need to know git, npm, or anything technical.

## What you'll need

- Google Chrome (or any Chromium-based browser: Edge, Brave, etc.)
- About 5 minutes
- You already log in to Jira (`jira.visma.com`) and Google Calendar in
  this browser
- **Optional:** a GitHub account with access to the Visma repos you
  care about — only needed if you want to log commits and PR reviews.
  If you only want to log calendar meetings, skip this.

---

## Step 1 — Get the extension files

Ask Kristaps (or whoever sent you here) for the **latest `.zip`** of the
extension. It will be named something like
`tempo-auto-logger-vX.Y.zip`.

Save it somewhere you won't accidentally delete — for example:

- **Windows:** `C:\Users\<you>\AppData\Local\tempo-auto-logger\`
- **Mac/Linux:** `~/tempo-auto-logger/`

**Unzip it.** You should end up with a folder containing files like
`manifest.json`, `assets/`, `src/`, etc. That folder is the extension.

> ⚠️ Don't delete or move this folder after installing — Chrome loads the
> extension directly from it. If you move it, the extension will break.

---

## Step 2 — Load the extension into Chrome

1. In Chrome, open a new tab and go to: `chrome://extensions`
2. In the **top-right corner**, turn on **Developer mode**.
3. Three new buttons appear. Click **Load unpacked**.
4. Browse to the **unzipped folder** from Step 1 and select it.
5. You should see a new card: *Tempo Auto Logger*. Done.

> 💡 Pin the extension so you can find it: click the puzzle-piece icon
> next to Chrome's address bar → find *Tempo Auto Logger* → click the
> pin icon. Now it's always visible.

---

## Step 3 — Create a GitHub token *(optional)*

> ⏭️ **Skip this step** if you only want to log calendar meetings (no
> commits or PR reviews). The extension runs fine without a token —
> you'll see a small blue banner saying *"Meetings-only mode"* at the
> top of the popup. Jump straight to Step 5.

The extension needs a small token to read **your own** commits and PR
reviews from GitHub. It can only read — it cannot write, push, or delete.

1. Open: https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**.
3. Fill in:
   - **Note:** `tempo-auto-logger`
   - **Expiration:** whatever you like (90 days, 1 year, or no
     expiration — up to you)
   - **Scopes:** tick **`repo`** and **`read:user`**
4. Click **Generate token** at the bottom.
5. **Copy the token** (starts with `ghp_...`). You won't see it again.

---

## Step 4 — Paste the token into the extension *(optional)*

> ⏭️ Also skip this if you skipped Step 3.

1. Click the Tempo Auto Logger icon in Chrome → a popup appears.
2. Click **Settings** (top-right of the popup).
3. Go to the **GitHub** tab.
4. Paste your token → click **Save**.

You can close Settings now.

---

## Step 5 — Try it out

1. Make sure you're logged in to both
   [Jira](https://jira.visma.com) and
   [Google Calendar](https://calendar.google.com) in this browser. (If
   you already use them daily, you are.)
2. Click the extension icon → popup appears.
3. Click **Yesterday** (or any date range).
4. Click **Log 2026-XX-XX**.
5. You'll see a preview of commits, reviews, and meetings the extension
   found. Uncheck anything you don't want. Edit times if needed.
6. Click **Post to Tempo** — entries are logged one by one. Green ✓ means
   it went in.

---

## Mapping meetings to Jira issues

The first time the extension sees a meeting it doesn't recognize, it
shows up in the yellow **"Map N meetings to Jira"** section under the
preview. You:

- Type or pick the **Jira key** (e.g. `NUMO-1234`)
- Optionally **edit the match text** (this is what it'll match against
  future meetings — keep it short and case-insensitive, e.g. `daily
  standup`)
- Or tick **Skip** if this meeting shouldn't be logged at all
  (out-of-office, lunch, etc.)
- Click **Save**

Next time, the extension will auto-map it.

You can manage all your mappings under **Settings → Meetings**.

---

## Updating the extension

When Kristaps sends a new `.zip`:

1. Unzip it, replacing the files in your existing folder (**keep the
   same folder path**).
2. In Chrome, go to `chrome://extensions` and click the **↻ reload**
   button on the *Tempo Auto Logger* card.

That's it. Your settings, GitHub token, and meeting mappings are
preserved between updates.

---

## Troubleshooting

**"Jira session expired" error**
→ Open `jira.visma.com` in a tab and log in again. Retry the popup.

**"Calendar session expired" error**
→ Open `calendar.google.com` in a tab and make sure you're signed in.

**No commits showing up**
→ Double-check that your GitHub token has the `repo` and `read:user`
scopes (Step 3). Re-generate and re-paste if unsure.

**Extension card disappeared / stopped working**
→ Chrome auto-disables "unpacked" extensions sometimes. Go to
`chrome://extensions`, find the card, and toggle it back on. If the
folder was moved or deleted, repeat Step 2.

**Something else**
→ Ping Kristaps on Slack or open an issue at the [GitHub
repo](https://github.com/kristapsk123/tempo-auto-logger/issues).

# Install Tempo Auto Logger (no coding required)

This guide is for teammates who just want to **install and use** the
extension. You don't need to know git, npm, or anything technical.

> 💡 If you were already using the extension as a manually-loaded
> unpacked folder, follow [MIGRATION.md](MIGRATION.md) instead — it
> covers how to switch over without losing your saved settings.

## What you'll need

- Google Chrome
- Local admin rights on your machine (the script auto-elevates via
  UAC — you click *Yes* once)
- About 2 minutes
- You already log in to Jira (`jira.visma.com`) and Google Calendar in
  this browser
- **Optional:** a GitHub personal access token — only needed if you
  want to log commits and PR reviews. Skip if you only want to log
  calendar meetings (the extension runs fine in *meetings-only mode*).

---

## Step 1 — Run the installer

1. Download
   [`install.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/install.ps1)
   to anywhere convenient (Downloads is fine).
2. Open **Windows PowerShell** (Start → type "PowerShell" → Enter).
3. Paste this (adjust the path if you saved `install.ps1` somewhere
   other than Downloads):

   ```powershell
   cd $env:USERPROFILE\Downloads
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

4. Windows shows a UAC prompt asking for admin permission. Click
   **Yes**.
5. The script writes a Chrome policy that tells Chrome to install the
   extension automatically from our GitHub Pages host.
6. Press **Enter** to close the window when it's done.

---

## Step 2 — Restart Chrome

1. Close **all** Chrome windows.
2. Open Task Manager (Ctrl+Shift+Esc) → check there are no
   `chrome.exe` processes left. End any leftover ones if there are.
3. Open Chrome again.
4. Within about 30 seconds, the extension installs itself silently.
   You should see the Tempo Auto Logger icon appear in the toolbar
   (look for the puzzle-piece icon next to the address bar — the
   extension might be tucked behind it; pin it for easy access).

> 💡 If you don't see the icon, open `chrome://extensions`. The
> extension should be listed with a "Managed by your organization"
> badge. That's expected — it means Chrome installed it as a managed
> policy extension.

---

## Step 3 — Create a GitHub token *(optional)*

> ⏭️ **Skip this** if you only want to log calendar meetings. The
> extension shows a blue *"Meetings-only mode"* banner and works fine
> without a token.

The extension reads **your own** commits and PR reviews to figure out
which Jira tickets you worked on. It can only read — not push or
delete.

1. Open: https://github.com/settings/tokens
2. Click **Generate new token → Generate new token (classic)**.
3. Fill in:
   - **Note:** `tempo-auto-logger`
   - **Expiration:** whatever you like (90 days is fine)
   - **Scopes:** tick **`repo`** and **`read:user`**
4. Click **Generate token** at the bottom.
5. **Copy the token** (starts with `ghp_…`) — you won't see it again.

---

## Step 4 — Paste the token into the extension *(optional)*

> ⏭️ Skip if you skipped Step 3.

1. Click the **Tempo Auto Logger** icon in Chrome → popup opens.
2. Click **Settings** (top-right of the popup).
3. Go to the **GitHub** tab.
4. Paste your token → click **Save**.

---

## Step 5 — Try it out

1. Make sure you're logged in to both
   [Jira](https://jira.visma.com) and
   [Google Calendar](https://calendar.google.com) in this browser.
2. Click the extension icon → popup opens.
3. Click **Yesterday** (or another preset).
4. Click **Log 2026-XX-XX**.
5. The extension shows a preview of commits, reviews, and meetings it
   found. Uncheck anything you don't want. Adjust times if needed.
6. Click **Post to Tempo** — entries are logged one by one. Green ✓
   means it went in.

---

## Mapping meetings to Jira issues

The first time the extension sees a meeting it doesn't recognize, it
shows up in the yellow **"Map N meetings to Jira"** section under the
preview:

- Type or pick the **Jira key** (e.g. `NUMO-1234`)
- Optionally edit the **match text** (this is what's used to match
  future meetings — short and case-insensitive, e.g. `daily standup`)
- Or tick **Skip** if this meeting shouldn't be logged
  (out-of-office, lunch, etc.)
- Click **Save**

Next time, the extension auto-maps it. Manage all your mappings under
**Settings → Meetings**.

---

## Updates

You don't need to do anything. New versions install themselves
silently in the background within a few hours (or sooner if Chrome
happens to poll quickly). Your saved settings, token, and meeting
mappings are preserved automatically across updates.

If you want to know which version you're on, the popup shows a small
`vX.Y.Z` badge next to the title. Click it to check for updates
on-demand. Chrome rate-limits this — if it says "throttled, try again
in a minute", go to `chrome://extensions` (Developer mode on) and
click the **Update** button at the top instead.

Release notes for each version are at the
[GitHub releases page](https://github.com/kristapsk123/tempo-auto-logger/releases).

---

## Uninstalling

Run
[`uninstall.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/uninstall.ps1)
the same way you ran `install.ps1`. Restart Chrome and the extension
disappears.

---

## Troubleshooting

**`install.ps1` says "running scripts is disabled"**
→ You skipped the `-ExecutionPolicy Bypass` part. Paste the exact
command from Step 1 — it includes that flag.

**`install.ps1` says "Access to the registry key … is denied"**
→ The UAC prompt was either declined or didn't appear. Make sure you
clicked **Yes** when Windows asked for admin permission. If you don't
have admin rights on this machine, ask Visma IT to push the
`ExtensionInstallForcelist` policy for extension ID
`lllmnccgpmaohmachieeindoelkaaood` with update URL
`https://kristapsk123.github.io/tempo-auto-logger/updates.xml`.

**Extension didn't appear after restart**
→ Open `chrome://policy` in Chrome and click *Reload policies*.
Search for `ExtensionInstallForcelist`. You should see the Tempo
entry listed. If not, the installer didn't run as admin — repeat
Step 1.

**"Jira session expired" error**
→ Open `jira.visma.com` in a tab and log in again. Retry.

**"Calendar session expired" error**
→ Open `calendar.google.com` in a tab and make sure you're signed in.

**No commits showing up**
→ Double-check that your GitHub token has `repo` and `read:user`
scopes (Step 3). Regenerate and re-paste if unsure.

**Something else**
→ Ping Kristaps on Slack or open an issue at the
[GitHub repo](https://github.com/kristapsk123/tempo-auto-logger/issues).

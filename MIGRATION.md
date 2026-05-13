# Migrating to the auto-updating install

We're switching how Tempo Auto Logger is installed. After this
one-time migration, you'll never have to manually update again —
Chrome silently pulls new versions in the background.

**Estimated time:** ~5 minutes of your active attention. Chrome may
take an extra couple of minutes to install the extension after the
restart in step 3 — you can keep doing other things in the meantime.
Do this on each machine where you've loaded the extension.

**You'll need local admin rights on the machine.** The installer
script auto-elevates via a UAC prompt — you click *Yes* once. Without
admin, ask Visma IT to push the policy for you (details at the end of
this doc).

---

## 1. Export your current settings

If you have a saved GitHub PAT or custom meeting mappings, back them
up first so they're not lost when we uninstall the old version.

1. **Open the current extension's popup** by clicking its icon in the
   Chrome toolbar.
2. **Right-click anywhere inside the popup window itself** (not on the
   toolbar icon) and select **Inspect**. A DevTools window opens
   attached to *this* popup.

   > This is more reliable than the `chrome://extensions` service
   > worker link, because if you have two Tempo Auto Logger entries
   > installed (e.g. the old unpacked one and an in-progress CRX
   > install), the service worker link may attach to the wrong one
   > and you'll see empty storage.

3. Go to the **Console** tab.
4. Paste this and press Enter:

   ```js
   copy(JSON.stringify(await chrome.storage.local.get(null)))
   ```

   The full JSON of your saved settings is now in your clipboard.

   > Verify by opening Notepad and pressing Ctrl+V — you should see a
   > long JSON string starting with `{`. If you only see `{}`, your
   > storage is empty and you can skip the rest of this section (the
   > meeting mappings you see in the popup come from the bundled
   > `team-defaults.json` and don't need backing up).

5. Paste into Notepad and save as **`tempo-backup.json`** on your
   desktop. Keep it until step 4 is done — then you can delete it.

---

## 2. Remove the old unpacked extension

On `chrome://extensions`, find **Tempo Auto Logger** (the one *without*
the *"Managed by your organization"* badge if you have multiple) and
click **Remove**. Confirm.

---

## 3. Install the auto-updating version

1. Download
   [`install.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/install.ps1)
   to your Downloads folder.
2. Open **Windows PowerShell** (Start menu → type "PowerShell" → Enter).
3. Paste this exactly (adjust the path if you saved the script elsewhere):

   ```powershell
   cd $env:USERPROFILE\Downloads
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   The `-ExecutionPolicy Bypass` part matters — without it, Windows
   blocks the script with `running scripts is disabled on this system`.

4. Windows shows a UAC prompt asking for admin permission. Click
   **Yes**.
5. The script writes the Chrome policy. Press **Enter** to close the
   PowerShell window when it's done.
6. **Fully quit Chrome** — close all windows, then open Task Manager
   (Ctrl+Shift+Esc) and end any leftover `chrome.exe` processes.
7. **Reopen Chrome.** Within a minute or so the extension installs
   itself silently. The icon should appear in the toolbar (look behind
   the puzzle-piece icon next to the address bar; pin it for easy
   access).

   On `chrome://extensions` the card now shows a *"Managed by your
   organization"* badge — that's expected.

---

## 4. Restore your settings

1. Click the **Tempo Auto Logger** icon to open its popup.
2. **Right-click anywhere inside the popup window** → **Inspect**.
   DevTools opens.
3. Open your `tempo-backup.json` file in Notepad and **copy its full
   contents** to clipboard.
4. In the popup's Console, paste this and press Enter:

   ```js
   navigator.clipboard.readText().then(t => chrome.storage.local.set(JSON.parse(t)))
   ```

   It reads your clipboard, parses the JSON, and writes it to the new
   extension's storage.

5. **Close the popup window** (X button) and click the extension icon
   again to reopen. Your GitHub PAT, meeting mappings, theme, and
   other settings should all be back.

You can now delete `tempo-backup.json`.

---

## What this changes going forward

- **No more manual updates.** Chrome auto-installs new versions in the
  background. Realistic cadence: **within a few hours, or on next
  Chrome restart**. For urgent updates, you can speed this up by
  clicking the small `vX.Y.Z` badge next to the popup title (which
  triggers an on-demand check), or by clicking the *Update* button at
  the top of `chrome://extensions` with Developer mode on.
- **No more dist folder, no more reload button.** The extension
  behaves like a normal store-installed one.
- **Your storage persists across updates automatically** — Chrome
  treats the CRX as one stable extension, so PAT/mappings/templates
  survive future updates without any backup-and-restore step. The
  one-time backup we did above is only because we're switching
  installation method (which changes the extension's identity).

---

## If something goes wrong

- **`install.ps1` fails with "running scripts is disabled"**
  → You skipped the `-ExecutionPolicy Bypass` part. Re-run with the
  exact command from step 3.

- **`install.ps1` fails with "Access to the registry key … is denied"**
  → The UAC prompt was declined or never appeared. The script needs
  admin to write the machine-wide policy. Re-run and click **Yes** on
  the UAC prompt. If you don't have local admin on this machine, see
  the next section.

- **Icon never appears after step 3**
  → Open `chrome://policy` in Chrome and click **Reload policies**.
  Search for `ExtensionInstallForcelist`. You should see an entry
  with extension ID `lllmnccgpmaohmachieeindoelkaaood` and update URL
  `https://kristapsk123.github.io/tempo-auto-logger/updates.xml`. If
  it's there but the extension still isn't installing within a few
  minutes, restart Chrome once more. If the entry isn't there, the
  installer didn't run successfully — repeat step 3.

- **To uninstall completely:** run
  [`uninstall.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/uninstall.ps1)
  the same way you ran `install.ps1`, then restart Chrome.

---

## If you don't have local admin

Send Visma IT a short request asking them to add this to
**Chrome Browser Cloud Management → Apps & Extensions →
Force-Installed Apps and Extensions**, scoped to your team OU:

- **Extension ID:** `lllmnccgpmaohmachieeindoelkaaood`
- **Update URL:** `https://kristapsk123.github.io/tempo-auto-logger/updates.xml`
- **Why bundled, not Web Store:** internal team productivity tool;
  Visma doesn't allow non-approved Web Store extensions.

Once they push the policy, the extension installs silently — no
`install.ps1` needed on your machine. You'll still need to do steps 1
and 4 (export/restore settings) if you had the old unpacked install.

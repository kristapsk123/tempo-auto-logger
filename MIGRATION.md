# Migrating to the auto-updating install

We're switching how Tempo Auto Logger is installed. After this one-time
migration, you'll never have to manually update again — Chrome will
silently pull new versions from GitHub Pages within minutes of any
release.

**Estimated time:** 5 minutes. Do this on each machine where you've
loaded the extension.

## 1. Export your current settings

If you have a saved GitHub PAT or custom meeting mappings, back them up
first so they're not lost when we uninstall the old version.

1. Go to `chrome://extensions` in Chrome.
2. Make sure **Developer mode** is on (toggle in the top right).
3. Find **Tempo Auto Logger** and click the **service worker** link
   under it. A DevTools window opens.
4. In the Console tab, paste:

   ```js
   chrome.storage.local.get(null, x => console.log(JSON.stringify(x, null, 2)))
   ```

5. Right-click the printed object and copy it. Paste into a text file
   on your desktop named `tempo-backup.json`. Keep it until step 4 is
   done.

## 2. Remove the old unpacked extension

On `chrome://extensions`, find **Tempo Auto Logger** and click
**Remove**. Confirm.

## 3. Install the auto-updating version

1. Download
   [`install.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/install.ps1)
   somewhere (e.g. Downloads).
2. Right-click → **Run with PowerShell**. (If Windows blocks it: open
   PowerShell, `cd` to the folder, run
   `powershell -ExecutionPolicy Bypass -File .\install.ps1`.)
3. Fully quit Chrome — open Task Manager and confirm no `chrome.exe`
   processes are running.
4. Reopen Chrome. Within ~30 seconds you should see the extension icon
   reappear. On `chrome://extensions` it now shows as **Managed by your
   organization** (that's expected — it means policy-installed, which
   is how silent updates work).

## 4. Restore your settings

1. Click the Tempo Auto Logger icon to open its popup.
2. Right-click anywhere inside the popup → **Inspect**. DevTools opens.
3. In the Console tab, open your `tempo-backup.json` file, copy the
   entire JSON contents, then in the console paste:

   ```js
   chrome.storage.local.set(<paste your JSON here>)
   ```

   (Replace `<paste your JSON here>` with the JSON object itself —
   it should start with `{` and end with `}`.)

4. Close the popup and reopen it. Your GitHub PAT, meeting mappings,
   theme, and other settings should all be back.

You can now delete `tempo-backup.json`.

## What this changes going forward

- **No more manual updates.** Chrome polls GitHub every few minutes.
  Each new release auto-installs in the background.
- **No more dist folder, no more reload button.** The extension behaves
  like a normal store-installed one.
- **Your storage now persists across updates** — Chrome treats the CRX
  as one stable extension, so PAT/mappings/templates survive future
  updates automatically. No need to back up again.

## If something goes wrong

- **Icon never appears after step 3:** open `chrome://policy` in Chrome.
  You should see `ExtensionInstallForcelist` with the Tempo Auto Logger
  entry. If you don't, the `install.ps1` step didn't write the policy
  (rerun it). If you do see it but the extension still isn't installing,
  it might be blocked by Visma corporate policy — message Kristaps.
- **To uninstall:** run
  [`uninstall.ps1`](https://github.com/kristapsk123/tempo-auto-logger/raw/master/uninstall.ps1)
  and restart Chrome.

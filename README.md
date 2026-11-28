<p align="center">
  <picture>
    <img width="128" height="128" alt="image" src="https://github.com/user-attachments/assets/9661b546-0474-4661-b2f7-1e0031b0342e" />
  </picture>
</p>

<h1 align="center">Stratum</h1>

<p align="center">A simple yet powerful file manager designed to be beautiful, intuitive, and genuinely useful.</p>

<p align="center">
  <picture>
    <img style="border-radius:15px;" width="1200" alt="" src="https://github.com/user-attachments/assets/ffa71c4e-a2b2-4668-82b5-89e719eae452" />
  </picture>
</p>

## Features

- List and grid views with fast search, tabs, and breadcrumb navigation.
- A gallery mode to view the media files of the current directory.
- Thumbnails, drag + drop, and inline rename.
- Ambience mode and flair settings (themes, accents, icon tints).
- Customisable layout, keybinds, and view behavior.
- Built-in image/video conversion (via ffmpeg) and rasterized SVG previews.
- ... and much more.

## Why Stratum?

Stratum is designed to make file management feel calm, fast, and dependable. It stays out of your way for everyday tasks, but gives you powerful tools when you need to move quickly. It’s open-source, free of bloat, and focused on doing one thing really well: managing files.

<picture>
  <img style="border-radius:15px;" width="1200" alt="" src="https://github.com/user-attachments/assets/13c34138-ca3b-434e-9a75-9a2d91baaf18" />
</picture>

## Status

Early beta. The core workflow is stable, but some features and polish are still
in progress. More features will be added with time, and feedback is very much
welcome.

Like all betas, this release is still a work in progress. If you spot a bug or see an opportunity for improvement, don't be afraid to submit an issue.

## Quick start

### SFTP folders on Windows

Add a host from **Remote hosts** using a Windows OpenSSH alias or `user@host`. Install **OpenSSH Client** in Windows Optional features if needed. Stratum uses your OpenSSH configuration and non-interactive authentication. To check your setup, connect in Windows Terminal, verify the host fingerprint with the administrator, then test `ssh -o BatchMode=yes user@host` using the same destination. If a previously trusted key changes, confirm the replacement fingerprint independently before updating the affected known_hosts entry.

Right-click an SFTP folder or its tab and choose **Pin to places**. Select the pin in the sidebar to open that folder in the active pane. Stratum reconnects the saved host if needed. Remote places share the sidebar’s pin colors and shapes.

Choose **Properties** on a remote item, or press **Alt+Enter**, to inspect its path, size, modification time, permissions, and symbolic-link target. **Quick Move** (**Ctrl+Shift+M** by default) lists folders from both panes’ open remote tabs and recent tab history under **Connected hosts**. Search by host or path. Remote destinations work with local indexing turned off.

Drag attachments from a Windows mail or archive app onto an SFTP folder or tab to upload them. Stratum keeps temporary copies while the upload waits or runs, then cleans them up when the job finishes or is cancelled.

Open **Work → SFTP recovery** to inspect interrupted remote moves, deletes, and journalled destination copies, even while disconnected. Reconnecting retries checked restores. An occupied original leaves the staged item available for inspection. A partial-deletion notice means the original location may contain only surviving files.

Closing the warning or clearing finished jobs keeps the notice in Work. **Acknowledge** dismisses the current notice and leaves remaining files at their listed locations. If an original still needs restoration, Stratum keeps its recovery record and retries on reconnect. A newly restored partial item appears for review again. Older destination-only records may contain just the staging location.

Under **Settings → File views → Browsing**, enable **Keep offscreen rows in place** to delay closing gaps in either pane's list or grid. The setting applies when a listing reports that an item disappeared, including changes made outside Stratum. A refreshed listing can bring the name back immediately. Changing the folder, sort, filter, or view starts a fresh layout. Work reports the operation's actual completion independently.

### Run from source

```
pnpm install
pnpm run tauri dev
```

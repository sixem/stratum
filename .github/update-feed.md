# Stable Windows updates

The draft workflow builds the portable EXE, MSI, and NSIS setup EXE. It signs the setup EXE on Windows and verifies the signature against `STRATUM_UPDATER_PUBLIC_KEY` before updating the GitHub draft. Ordinary local builds work with the variable unset.

## Activation

1. Generate a Tauri key pair with `pnpm exec tauri signer generate -w <private-key-path>`. Back up the private key and password offline. Set the repository variable `STRATUM_UPDATER_PUBLIC_KEY` to the contents of the generated `.pub` file. Set Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the private file contents and its password.
2. Put the feed workflow, `scripts/build-update-feed.py`, and `scripts/verify_update_installer.py` on the default branch. Configure the repository's GitHub Pages publishing source as **GitHub Actions**. Allow release tags and the default branch in the deployment rules for the `github-pages` environment. The workflow deploys a dedicated Pages site for the feed. If this repository already serves another Pages site, include the feed in that site's deployment before enabling this workflow.
3. FIVE.SH serves an exact-path HTTPS 302 from `/stratum/updates/stable.json` to `https://sixem.github.io/stratum/updates/stable.json` with `Cache-Control: no-cache`. The destination starts serving JSON after the first feed deployment.
4. Run **Draft Windows Release**. Add the release notes and publish the stable release as latest. The **Publish stable update feed** workflow verifies the installer against the public key and deploys the version, notes, original GitHub publication time, installer URL and signature. The publish event must come from a user or a credential capable of triggering other workflows.

## Withdrawal and recovery

Run **Publish stable update feed** manually on the default branch. Enter a previous published, signed stable tag to restore that offer. Leave the tag blank to suspend updates, including when withdrawing the first signed release. Suspension removes the manifest. Clients rechecking the endpoint cannot install from that feed. Publish a new signed stable version or dispatch with its tag to resume. A failed verification leaves the currently deployed feed in place.

## Local builds and forks

A build with no public key keeps background checks offline. Open **Settings → Updates → Check now** to see that build's status. To distribute a fork, set its HTTPS feed in `src-tauri/tauri.conf.json`, change the expected GitHub release URL in `src-tauri/src/app/commands/updates.rs`, and build with the fork's own public key. The feed generator uses the workflow repository name.

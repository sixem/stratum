# Releases and updates

Run **Draft Windows Release** from the release commit, add release notes, and publish the draft as the latest stable release. **Publish stable update feed** verifies the signed installer and publishes the update offer.

To withdraw an offer, run **Publish stable update feed** manually with the tag field empty. To restore an offer, run it with a published, signed stable tag. A failed verification leaves the current feed unchanged.

The release workflows use the `STRATUM_UPDATER_PUBLIC_KEY` repository variable and the `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and `GH_PAT` secrets.

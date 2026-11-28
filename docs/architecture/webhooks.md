# Webhook delivery

In Settings → Webhooks, save a destination and select its operation types. **Send test** queues a `webhook.test` request with empty details, including for a paused subscription. The receiver should return a 2xx status as soon as it accepts the request. Stratum does not follow redirects.

## Version 1 payload

Stratum POSTs UTF-8 JSON with `Content-Type: application/json`. An optional bearer token goes in the Authorization header.

```json
{
  "version": 1,
  "eventId": "80ededba-6d00-46ff-9ca2-d6efa21f5597",
  "operationId": "work-42",
  "timestampMs": 1780000000000,
  "type": "file.moved",
  "origin": "user",
  "details": {
    "source": { "kind": "local", "path": "C:\\Drafts\\report.txt" },
    "destination": { "kind": "sftp", "hostId": "lab", "path": "/incoming/report.txt" }
  }
}
```

`timestampMs` is Unix time in milliseconds at the originating event. `operationId` groups the events from one operation. SFTP locations identify the saved host profile and preserve its remote path. Item events describe confirmed selected roots. Creation includes the destination. Copy, move, and rename include both locations. Deletion includes the source and a `method` of `permanent` or `recycleBin`. The three terminal transfer types include `details.counts` with `copied`, `moved`, `skipped`, and `failed`.

## Delivery guarantees

- Capture and delivery run independently of the filesystem operation. Matching starts when the subscription is saved and enabled. Capture reads a bounded in-memory stream. Closing Stratum before capture commits can lose an event. Work shows the count of events missed when the stream overflows.
- Once queued in the profile database, each delivery survives restart until a 2xx response, dismissal, or subscription removal. A failure stays in Work. Stratum makes at most three attempts per retry cycle, with a 10-second request deadline and backoff of one and four seconds for network errors, HTTP 408, 425, 429, and 5xx. Other HTTP failures go directly to Work.
- Stratum can close after the receiver accepts a request and before acknowledgement is saved. On restart, an unconfirmed attempt counts toward the limit. Manual retry starts a fresh cycle with the original payload. Automatic and manual retries preserve the event ID. Receivers should deduplicate by event ID. Delivery order can change during retry.
- Pausing stops capture and queued operation deliveries for that subscription. Explicit tests still run. An in-flight request may finish. Editing the URL clears the old token and prevents pending requests from being forwarded to the new destination. Restore the original URL to retry them, or dismiss them in Work.

## Credentials and backups

Complete URLs and bearer tokens are encrypted with Windows DPAPI for the current user. Only the receiver origin is shown after saving. HTTPS is required except for numeric loopback HTTP endpoints. Webhook subscriptions, credentials, and the delivery database are excluded from full and workspace exports. Undelivered payloads, including file paths, are stored in the local application profile. Successful deliveries are removed from the queue.

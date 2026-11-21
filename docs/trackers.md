# Trakt and Simkl on the site

Settings → Account on the site has Trakt and Simkl cards, as atlantic.bz does. They
need your own free app on each service. Once they are set up:

- **In:** your watchlist becomes the "Watchlist" list, films you watched are marked
  watched, and Trakt's paused films and episodes join Continue Watching. This runs when
  you connect, from "Sync now", and once a day.
- **Out:** Trakt hears start, pause and stop while you watch. Simkl gets a film or
  episode added to your history when you finish it.

## 1. Make the apps (once)

**Trakt:** sign in at <https://trakt.tv/oauth/applications/new>.
- Name: Aurora
- Redirect URI: `urn:ietf:wg:oauth:2.0:oob`
- Save, then copy the **Client ID** and the **Client Secret**.

**Simkl:** sign in at <https://simkl.com/settings/developer/new/>.
- Name: Aurora
- Redirect URI: `urn:ietf:wg:oauth:2.0:oob`
- Save, then copy the **Client ID**.

## 2. Give them to the site

Create `site/trackers.local.json`. It is in `.gitignore`, so it never reaches git:

```json
{
  "trakt": { "client_id": "…", "client_secret": "…" },
  "simkl": { "client_id": "…" }
}
```

Restart the site's dev server. Only the two client IDs reach the page. Trakt's
secret stays with the site's relay (`/api/trakt/token` in `site/relay.cjs`).

## 3. Connect

Press **Connect** on a card. A new tab opens on Trakt or Simkl, and the card shows a
short code. Enter the code there and allow Aurora. The card then says who you are
connected as and starts the first sync. The sign-in is kept in this browser.

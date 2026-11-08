# OLFX Institutional Contract Flow

Institutional Flow is a separate page in the existing student portal, opened with the existing `showPage` navigation. No institutional charts are mounted in the dashboard. This change is intended for review on its own branch; it does not merge or deploy the portal.

## Available data and meaning

| Feature | State in this implementation | Reason |
| --- | --- | --- |
| GC / NQ Open Interest | HISTORICAL, official CFTC COT weekly reports | Free government dataset, futures only, all contract months aggregated |
| Contract Volume Monitor | Not available | COT open interest is not traded volume |
| Buyers vs Sellers | Not available | No licensed aggressor-side execution feed connected |
| Cumulative Volume Delta | Not available | No verified bid/ask execution feed connected |
| Volume Profile, POC, VAH, VAL | Not available | Requires traded volume by price and a defined session |
| Absorption / accumulation / distribution zones | Not available | Cannot be located from COT weekly open interest |
| Abnormal volume alerts | Not available | No verified intraday volume baseline |

The XAUUSD tab analyzes GC futures; it does not claim to measure the entire spot gold market. The NASDAQ tab analyzes the NQ CFTC contract market, not a broker's CFD. CFTC market codes are **088691** (Gold / COMEX) and **209742** (Nasdaq Mini / CME); micro futures and options-combined datasets are excluded. Each COT observation aggregates maturities rather than identifying one active expiry. Every report shows its observation date. The visible weekly change is **change in open interest**, never CVD.

Initial snapshots were fetched and validated on **8 November 2026**. The most recent report returned for both markets is dated **3 November 2026**. Data are never labeled LIVE or DELAYED. Archived pages remain HISTORICAL while the latest source report and source verification are current. If verification is older than three days, or the latest report is older than fourteen days, the source is marked OFFLINE while the dated archive remains inspectable.

## Source and redistribution review

Reviewed 8 November 2026:

- [CFTC web policy, Copyright](https://www.cftc.gov/WebPolicy/index.htm): CFTC government information is public domain and can be copied and distributed with appropriate acknowledgement. This module attributes the CFTC and does not use its seal or third-party images.
- [CFTC Legacy — Futures Only](https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy-Futures-Only/6dca-aqww): official dataset used by the bounded importer.
- [CFTC explanatory notes](https://www.cftc.gov/MarketReports/CommitmentsofTraders/ExplanatoryNotes/index.htm): definitions and public reporting API. COT measures weekly positions, not transaction-by-transaction activity.
- [CFTC COT overview](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm): usual Tuesday observations / Friday publication, subject to official schedule changes.
- [CME distribution licenses](https://www.cmegroup.com/market-data/license-data.html): distribution licensing covers real-time and delayed data. Reading public CME quote pages or owning a personal broker subscription is not treated as permission to redistribute an execution feed to students.

No paid provider, trial subscription, broker connection or scraped quote endpoint is connected. Adding intraday GC/NQ data requires a separate provider review covering display, redistribution, derived data, retention and student entitlements. The UI must keep its unsupported capabilities unavailable until that integration exists.

## Lifecycle and performance

- The initial HTML adds one existing-style navigation button and an empty hidden page. The bootstrap lives in the existing `script.js`; no extra startup script request is added.
- Only a successful navigation to the visible Institutional Flow page imports `entry.mjs` and its data client. Its stylesheet loads on demand. No chart library, framework, worker, socket or subscription is added.
- Rendering uses a bounded responsive SVG and an accessible values table. A page contains at most 13 observations. Older data are explicitly paginated, up to 52 weeks per market, rather than fetched or rendered together.
- The data client coalesces concurrent identical requests. It shares at most eight cached public pages across remounts, with a 15-minute TTL. Refresh and expired entries use conditional HTTP revalidation (`cache: no-cache`). No personal data enter this cache.
- Leaving, logging out, hiding the browser tab, and `pagehide` destroy the mounted DOM, abort fetches, cancel timeout/backoff and stylesheet preparation, and remove the module's handlers. Re-entry reuses loaded code, loaded CSS and valid cached pages. Import generation checks prevent late mounts after navigation.
- Network failures receive at most one retry after a one-second backoff, with an eight-second timeout per attempt. Invalid schema, oversized responses, invalid JSON and unavailable paths fail closed. Restoring connectivity can revalidate the source while the module is open. Failed refreshes keep any existing dated historical view and show OFFLINE.
- Maximum JSON response size is 32 KiB; real shipped pages are approximately 1.2 KiB. Market, CFTC code, dataset, report type, dates, order, page bounds and integer counts are validated before display. Provider fields use text/SVG nodes rather than HTML interpolation.
- CSS is scoped to `#institutionalFlowPage`. Other pages, authentication, membership checks, service worker and Supabase schema are unchanged.

## One shared update for all students

`python3 scripts/sync-institutional-flow.py` reads at most 52 official records for each of the two fixed markets. Both responses are validated before files are written. Errors leave the previous verified snapshots in place. The browser reads small same-origin static files and never queries the CFTC separately for each student.

After this PR is merged, `institutional-flow-data.yml` runs once on weekdays at **18:17 Puerto Rico time (22:17 UTC)**, and also supports manual execution. The schedule checks for late/corrected reports without polling from student devices. It commits only `institutional-flow/data` and explicitly requests a branch-based GitHub Pages rebuild, because commits made with `GITHUB_TOKEN` do not automatically trigger Pages builds. It requires the repository's existing GitHub Pages service and Actions contents/pages write permissions. Branch protection can prevent automated pushes; in that case the workflow fails visibly and the UI's freshness checks mark old data OFFLINE. No workflow was run against production as part of this PR.

No new server, Supabase function or database migration is necessary. There is no API secret in the browser or repository. The scheduled job is a proposed repository workflow, not a newly purchased service.

## Verification

Run locally or through the included pull-request workflow:

```sh
node --test tests/*.test.cjs tests/*.test.mjs
python3 -m unittest discover -s tests -p '*_test.py'
node --check script.js
node --check institutional-flow/entry.mjs
node --check institutional-flow/data-client.mjs
```

Verified on 8 November 2026:

| Check | Observed result |
| --- | --- |
| Automated tests | 38 Node tests and 4 Python tests passed, including existing analytics and notification tests |
| Initial dashboard | 0 module code/CSS/data requests, 0 module timers and handlers |
| Startup payload change | 608 raw HTML bytes + 2,684 raw JS bytes; approximately 842 additional gzip bytes combined |
| First open, GC | 2 JS modules + 1 CSS file + 1 JSON page, approximately 32 KiB total uncompressed; no chart dependencies |
| GC / NQ selector | Official values rendered; report date and scope visible; source HISTORICAL |
| History navigation | 13 rows per requested page; older pages retain proper HISTORICAL status |
| Cached re-entry | No duplicate imports, CSS download or snapshot request within TTL |
| Normal exit | 0 module handlers, 0 timers, 0 in-flight requests, 0 module DOM descendants |
| Exit during delayed request | Abort recorded; 0 pending requests, handlers, timers or module DOM afterwards |
| Source failure | OFFLINE with retained dated data; successful refresh restores HISTORICAL |
| Mobile layout | 375 px and 390 px browser iframe viewports; menu opens/closes and returns to dashboard; GC/NQ switch works; no document overflow |
| Console in isolated QA | No uncaught errors |

Browser QA used a local-only shell with production API requests blocked and no signed-in account or student records. The QA instrumentation is not shipped. Tests cover responsive layout in Chromium, not a physical iPhone or Safari device. A one-run DOMContentLoaded comparison (364 ms baseline / 374 ms changed, cached environment) is not a statistically meaningful speed benchmark; the stronger evidence is the absence of any institutional module request or processing in the initial dashboard. Real-device memory/CPU measurements and authenticated production smoke testing remain deployment checks.

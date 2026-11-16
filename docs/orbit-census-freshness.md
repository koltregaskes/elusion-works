# Orbit Census acquisition freshness

The builder and shared browser/publication validator use
`demos/orbit-census/src/freshness-policy.js` as their single policy source.

| Dataset or timestamp | Cache reuse | Publication age limit |
|---|---|---|
| GP responses | Under 2 hours | Up to 18 hours |
| SATCAT response | Under 24 hours | Up to 24 hours |
| Catalogue assembly | Not a provider cache | Up to 18 hours |

The existing five-minute future-clock tolerance remains. Every response date must
be a valid UTC calendar timestamp. Cache reuse never advances its acquired date;
Last-Modified and ETag remain nullable source-edition hints. Assembly time is
distinct from response acquisition and each object's original element epoch.
Old elements remain visibly labelled rather than being re-dated.

A cache-valid response is within its dataset's publication age limit. In
particular, 20-hour SATCAT is reused and may publish with fresh GP/assembly.
After 24 hours the builder refreshes SATCAT; publication rejects an unrefreshed
over-age response. A provider error or persisted retry deadline blocks the
acquisition normally; freshness validation never forces extra downloads before
the cache expires. The private retry entry is not public acquisition metadata.

`scripts/catalogue-reconciliation.test.mjs` runs the real merged builder and
the exact workflow validator with mocked CSV responses and a process-local clock.
It proves reuse at 20 hours, refresh after 24 hours, rejection of the old date,
unchanged cached timestamps, and preservation of the notice inside the main
landmark. It is not hosted-cache, live-provider or rendered acceptance evidence.

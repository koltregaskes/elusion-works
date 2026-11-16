import {CELESTRAK_SATCAT} from './catalog.js';

// Cache reuse and publication must agree for each dataset. These are acquisition
// ages, not orbital-element epochs or guarantees of an upstream source edition.
export const HOUR_MS = 3600000;
export const GP_CACHE_MS = 2 * HOUR_MS;
export const GP_FRESHNESS_MS = 18 * HOUR_MS;
export const SATCAT_CACHE_MS = 24 * HOUR_MS;
export const SATCAT_FRESHNESS_MS = SATCAT_CACHE_MS;
export const ASSEMBLY_FRESHNESS_MS = 18 * HOUR_MS;

export const responseFreshnessLimit = url => url === CELESTRAK_SATCAT
  ? SATCAT_FRESHNESS_MS : GP_FRESHNESS_MS;

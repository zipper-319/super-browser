/**
 * Network request classifier — categorizes captured requests.
 * Separates business APIs from tracking, static resources, and noise.
 */

import type { RequestClassification } from './types.js';

// ---- Tracking / analytics URL patterns ----
const TRACKING_PATTERNS = [
  /\/collect\b/i,
  /\/track(ing)?\b/i,
  /\/log(s|ging)?\b/i,
  /\/beacon\b/i,
  /\/analytics/i,
  /\/telemetry/i,
  /\/pixel/i,
  /\/report\b/i,
  /\/metrics\b/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.com\/tr/i,
  /doubleclick\.net/i,
  /umeng\.com/i,
  /cnzz\.com/i,
  /baidu\.com\/hm/i,
  /tongji\.baidu\.com/i,
  /alicdn\.com\/.*tracker/i,
  /sentry\.(io|dev)/i,
  /bugsnag/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /arms-retcode/i,
  /aegis\.qq\.com/i,
  /\/apm\//i,
  /\/rum\b/i,
];

// ---- Static resource patterns ----
const STATIC_EXTENSIONS = /\.(js|css|woff2?|ttf|eot|otf|map|ico)(\?|$)/i;
const MEDIA_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|ogg|wav)(\?|$)/i;

// ---- Prefetch / internal patterns ----
const PREFETCH_PATTERNS = [
  /\/sw\.js/i,
  /\/service-worker/i,
  /\/manifest\.json/i,
  /\/workbox/i,
  /\/__/,  // Firebase internal
];

// ---- Business API positive signals ----
const BUSINESS_CONTENT_TYPES = [
  'application/json',
  'text/json',
  'application/x-ndjson',
];

const BUSINESS_URL_SIGNALS = [
  /\/api\//i,
  /\/v[0-9]+\//i,
  /\/graphql/i,
  /\/rpc\//i,
  /\/rest\//i,
  /\/data\//i,
  /\/query/i,
  /\/search/i,
  /\/list/i,
  /\/detail/i,
  /\/item/i,
  /\/product/i,
  /\/goods/i,
  /\/order/i,
  /\/user/i,
  /\/cart/i,
  /\/comment/i,
  /\/review/i,
  /\/recommend/i,
  /\/suggest/i,
  /\/autocomplete/i,
  /\/category/i,
  /\/filter/i,
  /\/page/i,
];

/**
 * Classify a network request.
 */
export function classify(
  url: string,
  method: string,
  contentType: string,
  resourceType: string,
): RequestClassification {
  // 1. Static resources
  if (STATIC_EXTENSIONS.test(url)) return 'static';
  if (MEDIA_EXTENSIONS.test(url)) return 'media';

  // 2. Prefetch / service worker
  for (const pat of PREFETCH_PATTERNS) {
    if (pat.test(url)) return 'prefetch';
  }

  // 3. Tracking / analytics
  for (const pat of TRACKING_PATTERNS) {
    if (pat.test(url)) return 'tracking';
  }

  // 4. Business API — positive classification
  const isJsonContent = BUSINESS_CONTENT_TYPES.some((ct) => contentType.includes(ct));
  const hasBusinessSignal = BUSINESS_URL_SIGNALS.some((pat) => pat.test(url));

  if (isJsonContent && hasBusinessSignal) return 'business-api';
  if (isJsonContent && method === 'POST') return 'business-api';
  if (isJsonContent && url.includes('?')) return 'business-api'; // JSON with query params → likely API

  // 5. POST with JSON content is likely business even without URL signal
  if (method === 'POST' && isJsonContent) return 'business-api';

  // 6. JSON response without strong URL signal — still likely API
  if (isJsonContent) return 'business-api';

  return 'other';
}

/**
 * Score how likely a request is a "core data API" (higher = more interesting).
 * Used for ranking within business APIs.
 */
export function businessScore(req: {
  url: string;
  method: string;
  bodySize: number;
  status: number;
}): number {
  let score = 0;

  // Larger responses are more interesting (data payloads)
  if (req.bodySize > 5000) score += 3;
  else if (req.bodySize > 1000) score += 2;
  else if (req.bodySize > 100) score += 1;

  // POST with large body → search/filter API
  if (req.method === 'POST' && req.bodySize > 1000) score += 2;

  // URL signals
  if (/search|query|list|product|goods|item/i.test(req.url)) score += 3;
  if (/detail|info/i.test(req.url)) score += 2;
  if (/recommend|suggest/i.test(req.url)) score += 1;
  if (/\/api\/|\/v\d+\//i.test(req.url)) score += 1;

  // 200 OK is better than redirects/errors
  if (req.status === 200) score += 1;

  return score;
}

/**
 * Network monitoring types.
 */

export interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  contentType: string;
  /** Response body size in bytes */
  bodySize: number;
  /** Duration from request start to response end (ms) */
  duration: number;
  /** Whether classified as a business API */
  isBusinessApi: boolean;
  /** Classification label */
  classification: RequestClassification;
  /** Matched api_profile name (if any) */
  matchedProfile?: string;
  timestamp: number;
  /** Response body (for business APIs only, truncated) */
  responseBody?: string;
  /** Request POST body (truncated) */
  requestBody?: string;
}

export type RequestClassification =
  | 'business-api'   // Core data API (product list, search results, user info)
  | 'tracking'       // Analytics / telemetry / logging
  | 'static'         // JS / CSS / fonts / images
  | 'media'          // Images, video, audio content
  | 'prefetch'       // DNS prefetch, preload, service worker
  | 'other';         // Uncategorized

export interface MonitorState {
  pageId: string;
  active: boolean;
  startedAt: number;
  requests: CapturedRequest[];
  /** API patterns discovered by aggregator */
  discoveredPatterns: DiscoveredApiPattern[];
}

export interface DiscoveredApiPattern {
  /** URL pattern (path with IDs normalized to {id}) */
  urlPattern: string;
  method: string;
  /** Number of matching requests */
  count: number;
  /** Sample response structure keys */
  sampleResponseKeys: string[];
  /** Average response size */
  avgBodySize: number;
  /** Draft api_profile (partial) */
  draftProfile?: DraftApiProfile;
}

export interface DraftApiProfile {
  name: string;
  purpose: string;
  url_pattern: string;
  method: string;
  trigger: string;
  response?: {
    data_path: string;
    item_fields: string[];
    pagination?: {
      type: 'offset' | 'cursor' | 'page';
      param: string;
    };
  };
  auth: 'none' | 'cookie' | 'token' | 'signature';
  confidence: 'high' | 'medium' | 'low';
}

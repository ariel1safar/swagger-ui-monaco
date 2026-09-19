export interface MonacoOptions {
  enabled?: boolean;
  requestEditor?: boolean;
  objectParameters?: boolean;
  responseViewer?: boolean;
  validateResponses?: boolean;
  theme?: 'light' | 'dark' | 'auto';
  /** URL of the self-hosted plugin assets directory, including its trailing slash. */
  assetBaseUrl?: string;
}

export interface EditorContext {
  schema: unknown;
  mediaType: string;
  identity: string;
  direction: 'request' | 'response';
}

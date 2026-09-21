export type Action = 'everything' | 'posts' | 'highlights' | 'stories' | 'post' | 'current' | 'highlight';
export type Category = 'posts' | 'stories' | 'highlights';

interface ContextFields {
  url?: string;
  username?: string;
  shortcode?: string;
  storyId?: string | null;
  highlightId?: string;
}
export type PageContext = ContextFields & (
  | { type: 'unsupported' }
  | { type: 'profile'; username: string }
  | { type: 'post'; shortcode: string }
  | { type: 'story'; username: string; storyId: string | null }
  | { type: 'highlight'; highlightId: string; storyId: string | null }
);

export interface DownloadItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  username: string;
  category: Category;
  collection?: string;
  timestamp?: number | null;
  shortcode?: string;
  index?: number | null;
}
export interface MediaInfo { username?: string; category?: Category; collection?: string }
export interface MediaVersion {
  url?: string;
  src?: string;
  width?: number;
  height?: number;
  config_width?: number;
  config_height?: number;
  bitrate?: number;
}
export interface InstagramUser { id?: string; pk?: string | number; username?: string }
export interface ResolvedUser extends InstagramUser { id: string }
export interface RawMedia {
  id?: string;
  pk?: string | number;
  media_type?: number;
  is_video?: boolean;
  __typename?: string;
  video_versions?: MediaVersion[];
  video_url?: string;
  image_versions2?: { candidates?: MediaVersion[] };
  display_resources?: MediaVersion[];
  display_url?: string;
  carousel_media?: RawMedia[];
  edge_sidecar_to_children?: { edges: { node: RawMedia }[] };
  user?: InstagramUser;
  owner?: InstagramUser;
  taken_at?: number;
  taken_at_timestamp?: number;
  code?: string;
  shortcode?: string;
  media?: RawMedia;
}
export interface Reel { id?: string; title?: string; user?: InstagramUser; items?: RawMedia[] }
export interface InstagramResponse {
  status?: string;
  message?: string;
  challenge?: unknown;
  data?: { user?: InstagramUser };
  user?: InstagramUser;
  items?: RawMedia[];
  more_available?: boolean;
  next_max_id?: string;
  paging_info?: { more_available?: boolean; max_id?: string };
  reel?: Reel | null;
  reels?: Record<string, Reel>;
  reels_media?: Reel[];
  tray?: { id: string; title?: string }[];
}
export type ApiParams = Record<string, string | number | boolean>;
export type RequestMethod = 'GET' | 'POST';
export type InstagramRequest = (path: string, params: ApiParams, method: RequestMethod, signal: AbortSignal) => Promise<InstagramResponse>;

export interface CollectionBatch {
  media?: RawMedia[];
  info?: MediaInfo;
  label?: string;
  items?: DownloadItem[];
  warning?: string;
}
export interface MediaBatch extends CollectionBatch { media: RawMedia[]; info: MediaInfo; label: string }
export interface Capture { context: PageContext; snapshot: DownloadItem | null }
export interface CollectionJob { action: Action; context: PageContext; snapshot?: DownloadItem | null }
export interface DownloadJob extends CollectionJob { id: string; sourceTabId: number; created: number }
export interface HistoryRecord { title: string; detail: string; warnings: string[]; time: number; state: '' | 'warning' | 'error' }
export interface DownloadStats { saved: number; skipped: number; failed: number; bytes: number; consecutiveFailures: number; warnings: string[] }
export interface SessionState { jobs?: DownloadJob[]; sourceTabId?: number }
export interface LocalState { history?: HistoryRecord[]; folderConfigured?: boolean }

export type RuntimeRequest =
  | { type: 'OPEN_MANAGER' }
  | ({ type: 'QUEUE_JOB'; action: Action; sourceTabId?: number } & Capture)
  | { type: 'FINISH_JOB'; id: string }
  | { type: 'CLEAR_QUEUE' };
export type RuntimeReply = { ok: true; id?: string } | { ok: false; error: string };
export type ContentRequest = { type: 'CAPTURE' } | { type: 'NOTICE'; text: string };
export type CollectorCommand = { type: 'START'; job: DownloadJob } | { type: 'ACK' } | { type: 'CANCEL' };
export interface DownloadBatch { items?: DownloadItem[]; warning?: string; warnings?: string[]; label?: string }
export type CollectorReply = ({ type: 'BATCH' } & DownloadBatch) | { type: 'DONE' } | { type: 'ERROR'; error: string };

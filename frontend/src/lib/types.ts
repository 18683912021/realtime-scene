export type Emotion = 'soft' | 'guarded' | 'surprised';
export type Action = 'none' | 'wipe_lens' | 'look_window' | 'step_back';
export type SceneName = 'warm' | 'street';
export type Phase =
  | 'entry'
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'ended'
  | 'degraded';

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';

export interface MediaEvent {
  id: string;
  type: 'image' | 'video';
  url: string;
  caption?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface Directive {
  emotion?: Emotion;
  action?: Action;
  scene?: SceneName;
  camera?: 'push_in';
  fx?: 'lightning';
  media?: MediaEvent;
}

export interface AudioRequest {
  url: string;
  durationMs: number;
  turnId: string;
  nonce: number;
}

export interface ErrorInfo {
  code: string;
  stage: string;
  message: string;
  recoverable: boolean;
}

export interface LogEntry {
  at: number;
  label: string;
  detail?: string;
}

export interface ServerEvent {
  type: string;
  sessionId?: string;
  turnId?: string;
  epoch?: number;
  chunkIndex?: number;
  revision?: number;
  status?: string;
  text?: string;
  url?: string;
  durationMs?: number;
  format?: string;
  directive?: Directive;
  capabilities?: Record<string, unknown>;
  mode?: string;
  code?: string;
  stage?: string;
  message?: string;
  recoverable?: boolean;
  reason?: string;
  timing?: Record<string, number | null>;
}

export interface SessionState {
  phase: Phase;
  connection: ConnectionState;
  mode: string;
  sessionId: string;
  activeTurnId: string | null;
  epoch: number;
  lastUserText: string;
  replyText: string;
  emotion: Emotion;
  action: Action;
  scene: SceneName;
  camera: 'none' | 'push_in';
  fx: 'none' | 'lightning';
  fxNonce: number;
  media: MediaEvent | null;
  audioRequest: AudioRequest | null;
  audioProgress: number;
  audioPlaying: boolean;
  turnComplete: boolean;
  muted: boolean;
  captions: boolean;
  error: ErrorInfo | null;
  toast: string | null;
  log: LogEntry[];
  startedAt: number | null;
}

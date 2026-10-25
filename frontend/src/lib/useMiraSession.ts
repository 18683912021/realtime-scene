import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  Action as MiraAction,
  AudioRequest,
  Directive,
  Emotion,
  ErrorInfo,
  LogEntry,
  SceneName,
  ServerEvent,
  SessionState,
} from './types';

const initial: SessionState = {
  phase: 'entry',
  connection: 'idle',
  mode: 'mock',
  sessionId: '',
  activeTurnId: null,
  epoch: 0,
  lastUserText: '',
  replyText: '',
  emotion: 'soft',
  action: 'none',
  scene: 'warm',
  camera: 'none',
  fx: 'none',
  fxNonce: 0,
  media: null,
  audioRequest: null,
  audioProgress: 0,
  audioPlaying: false,
  turnComplete: false,
  muted: false,
  captions: true,
  error: null,
  toast: null,
  log: [],
  startedAt: null,
};

type ReducerAction =
  | { type: 'START'; startedAt: number }
  | { type: 'CONNECTING' }
  | { type: 'READY'; mode: string; sessionId: string }
  | { type: 'CONNECTION'; value: SessionState['connection'] }
  | { type: 'TURN_START'; turnId: string; epoch: number }
  | { type: 'TEXT_DELTA'; turnId: string; text: string }
  | { type: 'DIRECTIVE'; turnId: string; directive: Directive }
  | { type: 'AUDIO_REQUEST'; turnId: string; url: string; durationMs: number }
  | { type: 'AUDIO_PLAYING' }
  | { type: 'AUDIO_PROGRESS'; progress: number }
  | { type: 'AUDIO_ENDED' }
  | { type: 'AUDIO_ERROR'; message: string }
  | { type: 'USER_SUBMIT'; turnId: string; epoch: number; text: string }
  | { type: 'INTERRUPT'; epoch: number }
  | { type: 'TURN_END'; turnId: string; status: string }
  | { type: 'MEDIA_CLOSE' }
  | { type: 'SESSION_ENDED' }
  | { type: 'ERROR'; error: ErrorInfo }
  | { type: 'TOAST'; message: string | null }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_CAPTIONS' }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'RESET' };

function withLog(state: SessionState, label: string, detail?: string): SessionState {
  const entry: LogEntry = { at: Date.now(), label, detail };
  return { ...state, log: [...state.log.slice(-39), entry] };
}

function reducer(state: SessionState, action: ReducerAction): SessionState {
  switch (action.type) {
    case 'START':
      return { ...state, phase: 'connecting', connection: 'connecting', startedAt: action.startedAt, error: null };
    case 'CONNECTING':
      return { ...state, connection: 'connecting', phase: state.phase === 'entry' ? 'connecting' : state.phase };
    case 'READY':
      return {
        ...state,
        connection: 'ready',
        mode: action.mode,
        sessionId: action.sessionId,
        phase: 'idle',
        activeTurnId: null,
        replyText: '',
        audioRequest: null,
        audioPlaying: false,
        audioProgress: 0,
        media: null,
        turnComplete: false,
        error: null,
      };
    case 'CONNECTION':
      return { ...state, connection: action.value };
    case 'TURN_START':
      if (action.epoch < state.epoch) return state;
      return {
        ...state,
        activeTurnId: action.turnId,
        epoch: action.epoch,
        phase: 'thinking',
        replyText: '',
        action: 'none',
        camera: 'none',
        fx: 'none',
        media: null,
        audioRequest: null,
        audioProgress: 0,
        audioPlaying: false,
        turnComplete: false,
        error: null,
      };
    case 'TEXT_DELTA':
      if (action.turnId !== state.activeTurnId) return state;
      return { ...state, replyText: state.replyText + action.text };
    case 'DIRECTIVE':
      if (action.turnId !== state.activeTurnId) return state;
      return {
        ...state,
        emotion: action.directive.emotion ?? state.emotion,
        action: action.directive.action ?? state.action,
        scene: action.directive.scene ?? state.scene,
        camera: action.directive.camera ?? state.camera,
        fx: action.directive.fx ?? state.fx,
        fxNonce: action.directive.fx === 'lightning' ? state.fxNonce + 1 : state.fxNonce,
        media: action.directive.media ?? state.media,
      };
    case 'AUDIO_REQUEST':
      if (action.turnId !== state.activeTurnId) return state;
      return {
        ...state,
        audioRequest: {
          url: action.url,
          durationMs: action.durationMs,
          turnId: action.turnId,
          nonce: Date.now(),
        },
        phase: 'speaking',
        audioPlaying: false,
        audioProgress: 0,
      };
    case 'AUDIO_PLAYING':
      return { ...state, audioPlaying: true, phase: 'speaking' };
    case 'AUDIO_PROGRESS':
      return { ...state, audioProgress: Math.max(0, Math.min(1, action.progress)) };
    case 'AUDIO_ENDED':
      return {
        ...state,
        audioPlaying: false,
        audioRequest: null,
        audioProgress: 1,
        phase: state.turnComplete ? 'idle' : 'speaking',
        action: state.turnComplete ? 'none' : state.action,
      };
    case 'AUDIO_ERROR':
      return {
        ...state,
        audioPlaying: false,
        audioRequest: null,
        audioProgress: 1,
        phase: 'idle',
        action: 'none',
        toast: action.message,
        error: {
          code: 'E_AUDIO_DECODE',
          stage: 'audio',
          message: action.message,
          recoverable: true,
        },
      };
    case 'USER_SUBMIT':
      return {
        ...state,
        activeTurnId: action.turnId,
        epoch: action.epoch,
        lastUserText: action.text,
        phase: 'thinking',
        replyText: '',
        action: 'none',
        camera: 'none',
        fx: 'none',
        media: null,
        audioRequest: null,
        audioProgress: 0,
        audioPlaying: false,
        turnComplete: false,
        error: null,
      };
    case 'INTERRUPT':
      return {
        ...state,
        activeTurnId: null,
        epoch: action.epoch,
        phase: 'listening',
        replyText: '',
        action: 'none',
        camera: 'none',
        fx: 'none',
        media: null,
        audioRequest: null,
        audioProgress: 0,
        audioPlaying: false,
        turnComplete: false,
      };
    case 'TURN_END':
      if (action.turnId !== state.activeTurnId) return state;
      if (action.status === 'cancelled') {
        return {
          ...state,
          phase: 'listening',
          activeTurnId: null,
          replyText: '',
          audioRequest: null,
          audioPlaying: false,
          media: null,
          action: 'none',
          turnComplete: false,
        };
      }
      return {
        ...state,
        turnComplete: true,
        phase: state.audioRequest ? 'speaking' : 'idle',
        action: state.audioRequest ? state.action : 'none',
        error:
          action.status === 'failed'
            ? {
                code: 'E_TURN',
                stage: 'llm',
                message: '这一轮没有完整结束，可以继续问她。',
                recoverable: true,
              }
            : state.error,
        toast:
          action.status === 'truncated'
            ? '这段话被截断了，可以让她继续。'
            : state.toast,
      };
    case 'MEDIA_CLOSE':
      return { ...state, media: null };
    case 'SESSION_ENDED':
      return {
        ...state,
        phase: 'ended',
        activeTurnId: null,
        audioRequest: null,
        audioPlaying: false,
        media: null,
        turnComplete: true,
        action: 'none',
      };
    case 'ERROR':
      return {
        ...state,
        error: action.error,
        toast: action.error.message,
        phase: action.error.recoverable ? state.phase : 'degraded',
      };
    case 'TOAST':
      return { ...state, toast: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'TOGGLE_MUTE':
      return { ...state, muted: !state.muted };
    case 'TOGGLE_CAPTIONS':
      return { ...state, captions: !state.captions };
    case 'LOG':
      return { ...state, log: [...state.log.slice(-39), action.entry] };
    case 'RESET':
      return { ...initial, muted: state.muted, captions: state.captions };
    default:
      return state;
  }
}

function wsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/session`;
}

export function useMiraSession() {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef('');
  const intentionalCloseRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioTokenRef = useRef(0);
  const audioLevelRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelRafRef = useRef<number | null>(null);

  const log = useCallback((label: string, detail?: string) => {
    dispatch({ type: 'LOG', entry: { at: Date.now(), label, detail } });
  }, []);

  const ensurePlayer = useCallback(() => {
    if (!audioRef.current) {
      const player = new Audio();
      player.preload = 'auto';
      player.setAttribute('playsinline', 'true');
      audioRef.current = player;
    }
    return audioRef.current;
  }, []);

  const pumpAudioLevel = useCallback(() => {
    if (levelRafRef.current !== null) return;
    const tick = () => {
      const analyser = analyserRef.current;
      const data = analyserDataRef.current;
      let level = 0;
      if (analyser && data && stateRef.current.phase === 'speaking') {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        level = Math.min(1, Math.sqrt(sum / data.length) * 3.6);
      }
      // Attack fast enough to catch syllables, release slowly enough to avoid
      // a chattering jaw between words.
      const current = audioLevelRef.current;
      audioLevelRef.current = current + (level - current) * (level > current ? 0.5 : 0.18);
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const ensureAnalyser = useCallback(() => {
    if (analyserRef.current) return;
    const player = ensurePlayer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(player);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      analyserDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      void ctx.resume().catch(() => {});
      pumpAudioLevel();
    } catch {
      // Web Audio can be unavailable in hardened browsers; the character
      // falls back to a synthetic speech envelope.
    }
  }, [ensurePlayer, pumpAudioLevel]);

  const unlockAudio = useCallback(() => {
    const player = ensurePlayer();
    const muted = stateRef.current.muted;
    ensureAnalyser();
    player.src = '/assets/audio/silence.wav';
    player.volume = 0;
    void player.play().catch(() => {});
    window.setTimeout(() => {
      if (audioRef.current !== player || !player.src.includes('silence.wav')) return;
      player.pause();
      player.currentTime = 0;
      player.removeAttribute('src');
      player.load();
      player.volume = muted ? 0 : 1;
    }, 160);
  }, [ensureAnalyser, ensurePlayer]);

  const stopLocalAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audioTokenRef.current += 1;
    audio.onplaying = null;
    audio.ontimeupdate = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute('src');
    audio.load();
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      dispatch({
        type: 'ERROR',
        error: {
          code: 'E_WS_CLOSED',
          stage: 'connection',
          message: '连接还没有准备好，请稍等或重新进入。',
          recoverable: true,
        },
      });
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'session.ready':
        sessionIdRef.current = event.sessionId || sessionIdRef.current;
        dispatch({ type: 'READY', mode: event.mode || 'mock', sessionId: sessionIdRef.current });
        log('session.ready', event.mode);
        break;
      case 'turn.start':
        if (event.turnId) {
          dispatch({ type: 'TURN_START', turnId: event.turnId, epoch: event.epoch ?? 0 });
          log('turn.start', event.turnId);
        }
        break;
      case 'reply.text.delta':
        if (event.turnId && event.text) {
          dispatch({ type: 'TEXT_DELTA', turnId: event.turnId, text: event.text });
        }
        break;
      case 'reply.directive':
        if (event.turnId && event.directive) {
          dispatch({ type: 'DIRECTIVE', turnId: event.turnId, directive: event.directive });
          log('directive', JSON.stringify(event.directive));
        }
        break;
      case 'reply.audio.chunk':
        if (event.turnId && event.url) {
          dispatch({
            type: 'AUDIO_REQUEST',
            turnId: event.turnId,
            url: event.url,
            durationMs: event.durationMs ?? 2600,
          });
          log('reply.audio', `${event.url} ${event.durationMs ?? 0}ms`);
        }
        break;
      case 'reply.end':
        if (event.turnId) {
          dispatch({ type: 'TURN_END', turnId: event.turnId, status: event.status || 'completed' });
          log('reply.end', event.status);
        }
        break;
      case 'session.ended':
        dispatch({ type: 'SESSION_ENDED' });
        log('session.ended', event.reason);
        break;
      case 'sys.error':
        dispatch({
          type: 'ERROR',
          error: {
            code: event.code || 'E_UNKNOWN',
            stage: event.stage || 'internal',
            message: event.message || '服务暂时不可用。',
            recoverable: event.recoverable !== false,
          },
        });
        log('sys.error', `${event.code} ${event.message}`);
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }, [log]);

  const connect = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }
    intentionalCloseRef.current = false;
    dispatch({ type: 'CONNECTING' });
    const socket = new WebSocket(wsUrl());
    wsRef.current = socket;
    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      retryRef.current = 0;
      if (!sessionIdRef.current) {
        sessionIdRef.current = `scene-${crypto.randomUUID()}`;
      }
      socket.send(
        JSON.stringify({
          type: 'session.start',
          sessionId: sessionIdRef.current,
          clientVersion: 'web-0.1',
          mode: 'mock',
        }),
      );
    };
    socket.onmessage = (message) => {
      if (wsRef.current !== socket) return;
      try {
        const data = JSON.parse(message.data as string) as ServerEvent;
        handleEvent(data);
      } catch {
        dispatch({ type: 'TOAST', message: '收到一条无法解析的消息。' });
      }
    };
    socket.onerror = () => {
      if (wsRef.current !== socket) return;
      dispatch({ type: 'CONNECTION', value: 'error' });
    };
    socket.onclose = () => {
      if (wsRef.current !== socket) return;
      if (intentionalCloseRef.current) return;
      const active = stateRef.current.phase;
      if (active === 'ended') return;
      dispatch({ type: 'CONNECTION', value: 'reconnecting' });
      stopLocalAudio();
      dispatch({ type: 'INTERRUPT', epoch: stateRef.current.epoch + 1 });
      if (retryRef.current < 3) {
        retryRef.current += 1;
        const delay = 700 * retryRef.current;
        dispatch({ type: 'TOAST', message: '连接断了，正在重新推门…' });
        retryTimerRef.current = window.setTimeout(() => connect(), delay);
      } else {
        dispatch({
          type: 'ERROR',
          error: {
            code: 'E_WS_MAX_RETRY',
            stage: 'connection',
            message: '没能回到咖啡馆。请点击重新进入。',
            recoverable: false,
          },
        });
      }
    };
  }, [handleEvent, stopLocalAudio]);

  const start = useCallback(() => {
    dispatch({ type: 'START', startedAt: Date.now() });
    sessionIdRef.current = `scene-${crypto.randomUUID()}`;
    unlockAudio();
    connect();
  }, [connect, unlockAudio]);

  const interruptCurrent = useCallback(() => {
    const current = stateRef.current;
    if (!current.activeTurnId) {
      stopLocalAudio();
      dispatch({ type: 'INTERRUPT', epoch: current.epoch + 1 });
      return;
    }
    const nextEpoch = current.epoch + 1;
    send({
      type: 'user.interrupt',
      sessionId: sessionIdRef.current,
      interruptedTurnId: current.activeTurnId,
      newEpoch: nextEpoch,
    });
    stopLocalAudio();
    dispatch({ type: 'INTERRUPT', epoch: nextEpoch });
    log('user.interrupt', current.activeTurnId);
  }, [log, send, stopLocalAudio]);

  const submitText = useCallback(
    (text: string, inputMode: 'text' | 'voice' = 'text') => {
      const value = text.trim();
      if (!value) return;
      if (stateRef.current.phase === 'entry' || stateRef.current.phase === 'ended') return;
      const current = stateRef.current;
      if (current.activeTurnId) {
        send({
          type: 'user.interrupt',
          sessionId: sessionIdRef.current,
          interruptedTurnId: current.activeTurnId,
          newEpoch: current.epoch + 1,
        });
        stopLocalAudio();
        log('user.interrupt', current.activeTurnId);
      }
      const nextEpoch = current.epoch + 1;
      const turnId = `turn-${crypto.randomUUID()}`;
      dispatch({ type: 'USER_SUBMIT', turnId, epoch: nextEpoch, text: value });
      send({
        type: 'user.text',
        sessionId: sessionIdRef.current,
        turnId,
        epoch: nextEpoch,
        text: value,
        inputMode,
      });
      log('user.text', `${inputMode}: ${value}`);
    },
    [log, send, stopLocalAudio],
  );

  const endSession = useCallback(() => {
    intentionalCloseRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'session.end', sessionId: sessionIdRef.current, reason: 'client_stop' }),
      );
      wsRef.current.close();
    }
    stopLocalAudio();
    dispatch({ type: 'SESSION_ENDED' });
  }, [stopLocalAudio]);

  const restart = useCallback(() => {
    intentionalCloseRef.current = true;
    if (wsRef.current) wsRef.current.close();
    wsRef.current = null;
    retryRef.current = 0;
    stopLocalAudio();
    dispatch({ type: 'RESET' });
    sessionIdRef.current = `scene-${crypto.randomUUID()}`;
    window.setTimeout(() => {
      dispatch({ type: 'START', startedAt: Date.now() });
      unlockAudio();
      connect();
    }, 120);
  }, [connect, stopLocalAudio, unlockAudio]);

  const dismissMedia = useCallback(() => dispatch({ type: 'MEDIA_CLOSE' }), []);
  const toggleMute = useCallback(() => dispatch({ type: 'TOGGLE_MUTE' }), []);
  const toggleCaptions = useCallback(() => dispatch({ type: 'TOGGLE_CAPTIONS' }), []);
  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);
  const dismissToast = useCallback(() => dispatch({ type: 'TOAST', message: null }), []);
  const notify = useCallback((message: string) => dispatch({ type: 'TOAST', message }), []);

  // Play the current turn's audio. The element is recreated only for a new
  // audio request (nonce), not for volume changes.
  useEffect(() => {
    const request: AudioRequest | null = state.audioRequest;
    if (!request) return;
    const audio = ensurePlayer();
    const token = audioTokenRef.current + 1;
    audioTokenRef.current = token;
    audio.preload = 'auto';
    audio.volume = stateRef.current.muted ? 0 : 1;
    const current = () => audioRef.current === audio && audioTokenRef.current === token;
    audio.onplaying = () => {
      if (current()) dispatch({ type: 'AUDIO_PLAYING' });
    };
    audio.ontimeupdate = () => {
      if (!current()) return;
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : request.durationMs / 1000;
      dispatch({ type: 'AUDIO_PROGRESS', progress: duration ? audio.currentTime / duration : 1 });
    };
    audio.onended = () => {
      if (current()) dispatch({ type: 'AUDIO_ENDED' });
    };
    audio.onerror = () => {
      if (current()) dispatch({ type: 'AUDIO_ERROR', message: '声音没有加载成功，已切到字幕。' });
    };
    audio.src = request.url;
    audio.load();
    void audio.play().catch(() => {
      if (current()) dispatch({ type: 'AUDIO_ERROR', message: '浏览器拦截了声音，请点击声音按钮后重试。' });
    });
    return () => {
      if (audioTokenRef.current !== token) return;
      audio.onplaying = null;
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    };
  }, [state.audioRequest?.nonce, ensurePlayer]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = state.muted ? 0 : 1;
  }, [state.muted]);

  useEffect(() => {
    if (state.fx !== 'lightning' || state.fxNonce === 0 || state.muted) return;
    const thunder = new Audio('/assets/ambience/thunder.wav');
    thunder.volume = 0.32;
    void thunder.play().catch(() => {});
    return () => {
      thunder.pause();
    };
  }, [state.fxNonce, state.fx, state.muted]);

  useEffect(() => {
    if (state.phase !== 'thinking' || !state.activeTurnId) return;
    const turnId = state.activeTurnId;
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.phase !== 'thinking' || current.activeTurnId !== turnId) return;
      send({
        type: 'user.interrupt',
        sessionId: sessionIdRef.current,
        interruptedTurnId: turnId,
        newEpoch: current.epoch + 1,
      });
      dispatch({
        type: 'ERROR',
        error: {
          code: 'E_THINK_TIMEOUT',
          stage: 'llm',
          message: '她好像走神了，可以再问一次。',
          recoverable: true,
        },
      });
      dispatch({ type: 'INTERRUPT', epoch: current.epoch + 1 });
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.activeTurnId, send]);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'TOAST', message: null }), 4500);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  useEffect(() => {
    if (!state.media) return;
    const timer = window.setTimeout(() => dispatch({ type: 'MEDIA_CLOSE' }), state.media.durationMs ?? 6200);
    return () => window.clearTimeout(timer);
  }, [state.media]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      stopLocalAudio();
      if (levelRafRef.current !== null) {
        cancelAnimationFrame(levelRafRef.current);
        levelRafRef.current = null;
      }
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
      analyserDataRef.current = null;
    };
  }, [stopLocalAudio]);

  return {
    state,
    audioLevelRef,
    start,
    restart,
    endSession,
    submitText,
    interruptCurrent,
    dismissMedia,
    toggleMute,
    toggleCaptions,
    clearError,
    dismissToast,
    notify,
    log,
  };
}

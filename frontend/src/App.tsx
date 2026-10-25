import { useEffect, useMemo, useState } from 'react';
import Controls from './components/Controls';
import EndScreen from './components/EndScreen';
import Entry from './components/Entry';
import { CaptionIcon, CloseIcon, ExpandIcon, StarIcon, VolumeIcon } from './components/Icons';
import MediaCard from './components/MediaCard';
import Scene from './components/Scene';
import Subtitle from './components/Subtitle';
import { useMiraSession } from './lib/useMiraSession';
import { useServerASR } from './lib/useServerASR';
import { useVoiceInput } from './lib/useVoiceInput';

const PHASE_LABEL: Record<string, string> = {
  entry: '等待',
  connecting: '连接中',
  idle: '待机',
  listening: '倾听',
  thinking: '思考',
  speaking: '说话',
  ended: '结束',
  degraded: '信号不稳',
};

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const query = new URLSearchParams(window.location.search);
const rendererParam = query.get('renderer');
const live2dModel = query.get('model') || import.meta.env.VITE_LIVE2D_MODEL || '';
// The default Mira is an original adult VRM rendered with three-vrm. The SVG
// portrait is the fallback; Live2D stays available for a custom, properly
// licensed model via ?renderer=live2d&model=...
const renderer: 'vrm' | 'svg' | 'live2d' =
  rendererParam === 'svg'
    ? 'svg'
    : rendererParam === 'live2d' && Boolean(live2dModel)
      ? 'live2d'
      : 'vrm';

function primeMicrophonePermission() {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return;
  media
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => stream.getTracks().forEach((track) => track.stop()))
    .catch(() => {
      // The voice hook will surface the real error/fallback state.
    });
}

export default function App() {
  const {
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
    dismissToast,
    notify,
  } = useMiraSession();
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [serverMode, setServerMode] = useState<'mock' | 'live'>('mock');
  const [asrMode, setAsrMode] = useState<'browser' | 'tencent'>('browser');
  const [isFullscreen, setIsFullscreen] = useState(false);
  // The mic stays open by default. Only an explicit stop (or the end of the
  // session) turns this off, so a reply can always hand the floor back.
  const [micDesired, setMicDesired] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.mode === 'live') setServerMode('live');
        if (data?.capabilities?.asr === 'tencent' || data?.capabilities?.stt === 'tencent') {
          setAsrMode('tencent');
        }
      })
      .catch(() => {});
  }, []);

  const voiceOptions = {
    onBargeIn: interruptCurrent,
    onResult: (text: string) => submitText(text, 'voice'),
    onNotice: notify,
    agentText: state.replyText,
    agentSpeaking: state.phase === 'speaking',
  };
  const browserVoice = useVoiceInput(voiceOptions);
  const serverVoice = useServerASR({
    ...voiceOptions,
    onUnavailable: () => setAsrMode('browser'),
  });
  const voice = asrMode === 'tencent' ? serverVoice : browserVoice;

  useEffect(() => {
    if (!state.startedAt) return;
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - (state.startedAt ?? Date.now()));
    }, 1000);
    setElapsed(Date.now() - state.startedAt);
    return () => window.clearInterval(timer);
  }, [state.startedAt]);

  useEffect(() => {
    if (!micDesired) return;
    if (state.connection !== 'ready') return;
    if (state.phase === 'entry' || state.phase === 'ended' || state.phase === 'degraded') return;
    if (voice.listening) return;
    if (voice.micState === 'denied' || voice.micState === 'unavailable') return;
    // Browsers (and the speech service) can close recognition at any time,
    // including during a reply. The Start click was the permission gesture;
    // reopen the mic here (also during thinking/speaking, so barge-in works)
    // unless the user explicitly turned it off.
    const timer = window.setTimeout(() => {
      void voice.start(false);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    micDesired,
    state.connection,
    state.phase,
    voice.listening,
    voice.micState,
    voice.start,
  ]);

  const forcedVoiceStop = voice.forcedStop;
  useEffect(() => {
    if (state.phase === 'ended') {
      forcedVoiceStop();
    }
  }, [state.phase, forcedVoiceStop]);

  const showEntry = state.phase === 'entry' || state.phase === 'connecting';
  const showHud = !showEntry && state.phase !== 'ended';
  const showFatal = state.error && !state.error.recoverable && state.phase === 'degraded';
  const showInteractionLayer = !showEntry && state.phase !== 'ended' && !showFatal;
  const subtitleProgress = state.audioRequest ? state.audioProgress : 1;
  const showSubtitle = Boolean(state.replyText) && state.phase !== 'entry' && state.phase !== 'ended';
  const liveUserText = voice.interim.trim();
  const userText = liveUserText || state.lastUserText.trim();
  const showSuggestions =
    state.phase === 'idle' &&
    state.connection === 'ready' &&
    !voice.listening &&
    !state.media &&
    !showFatal;

  // The mic stays open after a line lands. Treat that as listening visually,
  // otherwise the HUD says "待机" while the user is being heard.
  const visualPhase =
    state.phase === 'idle' || state.phase === 'listening'
      ? voice.listening
        ? 'listening'
        : 'idle'
      : state.phase;
  const phaseLabel = useMemo(() => PHASE_LABEL[visualPhase] ?? '待机', [visualPhase]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleStart = () => {
    setMicDesired(true);
    // Ask for microphone access during the click, while browser user
    // activation is still live. The ASR stream itself starts once the
    // session/ASR socket is ready, but mobile Safari has already granted the
    // permission by then.
    void primeMicrophonePermission();
    start();
  };

  const handleRestart = () => {
    setMicDesired(true);
    void primeMicrophonePermission();
    restart();
  };

  const handleEnd = () => {
    setMicDesired(false);
    endSession();
  };

  const handleMicStart = () => {
    setMicDesired(true);
    const interrupting = state.phase === 'thinking' || state.phase === 'speaking';
    void voice.start(interrupting);
  };

  const handleMicStop = () => {
    setMicDesired(false);
    voice.stop();
  };

  return (
    <main className="app">
      <div className="app-backdrop" />
      <div className={`stage scene-${state.scene}`}>
        <Scene
          renderer={renderer}
          live2dModel={live2dModel}
          scene={state.scene}
          camera={state.camera}
          fx={state.fx}
          fxNonce={state.fxNonce}
          phase={visualPhase}
          emotion={state.emotion}
          action={state.action}
          audioLevelRef={audioLevelRef}
          voiceLevel={voice.level}
        />

        <div className="stage-vignette" />

        {showHud && (
          <header className="hud">
            <div className="hud-left">
              <div className="brand-mark">
                <StarIcon size={14} />
                <span>雨停之前</span>
              </div>
              <div className={`phase-chip phase-${visualPhase}`}>
                <span className="phase-dot" />
                {phaseLabel}
              </div>
            </div>
            <div className="hud-right">
              <span className="timer">{formatTime(state.startedAt ? elapsed : 0)}</span>
              <button
                type="button"
                className="hud-button fullscreen-button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? '退出全屏' : '全屏'}
              >
                <ExpandIcon />
              </button>
              <button
                type="button"
                className="hud-button"
                onClick={toggleCaptions}
                aria-pressed={state.captions}
                aria-label={state.captions ? '关闭字幕' : '打开字幕'}
              >
                <CaptionIcon />
              </button>
              <button
                type="button"
                className="hud-button"
                onClick={toggleMute}
                aria-pressed={state.muted}
                aria-label={state.muted ? '打开声音' : '静音'}
              >
                <VolumeIcon muted={state.muted} />
              </button>
              <button type="button" className="hud-button hud-end" onClick={handleEnd} aria-label="结束这场对话">
                <CloseIcon />
              </button>
            </div>
          </header>
        )}

        {showInteractionLayer && <div className="bottom-wash" />}

        {showInteractionLayer && <div className="dialogue-layer">
          {userText && (
            <div
              className={`user-echo ${liveUserText ? 'is-live' : ''}`}
              aria-live={liveUserText ? 'off' : 'polite'}
              aria-label={liveUserText ? '正在识别你说的话' : '你刚才说'}
              title={userText}
            >
              <span className="user-echo-label">{liveUserText ? '识别中' : '你'}</span>
              <p>{userText}</p>
            </div>
          )}
          <Subtitle
            text={state.replyText}
            progress={subtitleProgress}
            captions={state.captions}
            visible={showSubtitle}
          />

          <Controls
            phase={state.phase}
            connected={state.connection === 'ready'}
            listening={voice.listening}
            level={voice.level}
            draft={draft}
            onDraft={setDraft}
            onSend={(text) => {
              submitText(text, 'text');
              setDraft('');
            }}
            onMicStart={handleMicStart}
            onMicStop={handleMicStop}
            onSuggestion={(text) => {
              submitText(text, 'text');
            }}
            showSuggestions={showSuggestions}
            mode={state.mode === 'live' ? 'live' : 'mock'}
          />
        </div>}

        {state.media && <MediaCard key={state.media.id} media={state.media} onClose={dismissMedia} />}

        {state.toast && !showFatal && (
          <div className="toast" role="status">
            <span>{state.toast}</span>
            <button type="button" onClick={dismissToast} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}

        {showEntry && <Entry connecting={state.phase === 'connecting'} mode={serverMode} renderer={renderer} onStart={handleStart} />}
        {state.phase === 'ended' && <EndScreen onRestart={handleRestart} />}

        {showFatal && state.error && (
          <div className="fatal-layer" role="alertdialog" aria-label="连接失败">
            <div className="fatal-card">
              <span className="fatal-kicker">CONNECTION LOST</span>
              <h2>窗外的光忽然暗了。</h2>
              <p>{state.error.message}</p>
              <div className="fatal-actions">
                <button type="button" className="enter-button" onClick={handleRestart}>
                  <span>重新进入</span>
                  <span className="enter-arrow">↺</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

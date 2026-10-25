import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeAgentEcho } from './echoGuard';

type VoiceOptions = {
  onBargeIn: () => void;
  onResult: (text: string) => void;
  onNotice: (message: string) => void;
  /** The line Mira is currently saying / just said, used to drop TTS echo. */
  agentText: string;
  agentSpeaking: boolean;
};

type EchoMode = 'all' | 'standard' | 'unavailable' | 'unknown';
type MicState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable';

function echoModeOf(stream: MediaStream): EchoMode {
  const setting: unknown = stream.getAudioTracks()[0]?.getSettings().echoCancellation;
  if (setting === 'all') return 'all';
  if (setting === true || setting === 'remote-only') return 'standard';
  if (setting === false) return 'unavailable';
  return 'unknown';
}

function retryDelay(failures: number): number {
  return failures > 0 ? Math.min(1200, 150 * 2 ** Math.min(failures - 1, 4)) : 60;
}

export function useVoiceInput({
  onBargeIn,
  onResult,
  onNotice,
  agentText,
  agentSpeaking,
}: VoiceOptions) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [echoMode, setEchoMode] = useState<EchoMode>('unknown');
  const [micState, setMicState] = useState<MicState>('idle');
  const activeRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const recognitionActiveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const beginRef = useRef<() => void>(() => {});
  const recognitionErrorsRef = useRef(0);
  const bargedRef = useRef(false);
  const onBargeInRef = useRef(onBargeIn);
  onBargeInRef.current = onBargeIn;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const agentLinesRef = useRef<Array<{ text: string; at: number }>>([]);
  const agentSpeakingRef = useRef(false);
  const speechEndedAtRef = useRef(0);

  useEffect(() => {
    if (agentSpeaking) {
      agentSpeakingRef.current = true;
      return;
    }
    if (agentSpeakingRef.current) {
      agentSpeakingRef.current = false;
      speechEndedAtRef.current = Date.now();
    }
  }, [agentSpeaking]);

  useEffect(() => {
    const line = agentText.trim();
    if (!line) return;
    const now = Date.now();
    agentLinesRef.current = [
      ...agentLinesRef.current.filter((item) => now - item.at < 20000 && item.text !== line),
      { text: line, at: now },
    ].slice(-3);
  }, [agentText]);

  const isAgentEcho = useCallback((text: string) => {
    const now = Date.now();
    // Recognition can deliver a final result a moment after the audio stops;
    // keep the guard alive for that tail without filtering unrelated replies.
    if (!agentSpeakingRef.current && now - speechEndedAtRef.current > 1500) return false;
    return agentLinesRef.current.some(
      (line) => now - line.at < 20000 && looksLikeAgentEcho(text, line.text),
    );
  }, []);

  const scheduleRestart = useCallback((delay: number) => {
    if (!activeRef.current || restartTimerRef.current !== null) return;
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (activeRef.current) beginRef.current();
    }, delay);
  }, []);

  const cleanupMedia = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    recognitionActiveRef.current = false;
    recognitionErrorsRef.current = 0;
    bargedRef.current = false;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.abort();
    } catch {
      // already stopped
    }
    recognitionRef.current = null;
    cleanupMedia();
    setListening(false);
    setInterim('');
    setMicState('idle');
  }, [cleanupMedia]);

  const beginRecognition = useCallback(() => {
    if (!activeRef.current || recognitionActiveRef.current) return;
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      noticeRef.current('当前浏览器不支持持续语音识别，请用文字聊天，或换 Chrome / Edge。');
      activeRef.current = false;
      setListening(false);
      setMicState('unavailable');
      cleanupMedia();
      return;
    }
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event: any) => {
        let pending = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = String(result[0]?.transcript ?? '').trim();
          if (!text) continue;
          if (result.isFinal) {
            recognitionErrorsRef.current = 0;
            bargedRef.current = false;
            if (!isAgentEcho(text)) {
              onResultRef.current(text);
            }
          } else {
            pending += text;
          }
        }
        if (pending) recognitionErrorsRef.current = 0;
        // Start the barge-in on the first meaningful interim words instead of
        // waiting for the recognizer to finalize a sentence. One-character
        // backchannels such as “嗯” do not cut Mira off. TTS echo is not a
        // user turn, so it must not interrupt or appear in the composer.
        const echoed = isAgentEcho(pending);
        const meaningful = pending.replace(/[\s，。！？!?、,.]/g, '');
        if (!echoed && meaningful.length >= 2 && !bargedRef.current) {
          bargedRef.current = true;
          onBargeInRef.current();
        }
        setInterim(echoed ? '' : pending.slice(-120));
      };
      recognition.onstart = () => {
        recognitionActiveRef.current = true;
        setMicState('ready');
      };
      recognition.onerror = (event: any) => {
        recognitionActiveRef.current = false;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          const blocked = event.error === 'not-allowed';
          noticeRef.current(
            blocked
              ? '没有获得麦克风权限，可以继续用文字聊天。'
              : '当前浏览器没有可用的语音识别服务，可以继续用文字聊天。',
          );
          activeRef.current = false;
          if (restartTimerRef.current !== null) {
            window.clearTimeout(restartTimerRef.current);
            restartTimerRef.current = null;
          }
          setListening(false);
          setMicState(blocked ? 'denied' : 'unavailable');
          cleanupMedia();
          return;
        }
        if (!activeRef.current) return;
        if (event.error === 'no-speech' || event.error === 'aborted') {
          scheduleRestart(80);
          return;
        }
        recognitionErrorsRef.current += 1;
        if (recognitionErrorsRef.current === 1) {
          noticeRef.current('语音识别暂时不稳定，我会自动重试；也可以直接打字。');
        } else if (recognitionErrorsRef.current === 4) {
          noticeRef.current('语音识别有点不稳，我会继续在后台重试；也可以直接打字。');
        }
        // Chrome can leave a failed recognizer in a zombie state without
        // firing onend. Abort and schedule the restart explicitly instead of
        // relying on onend; otherwise the UI says "listening" while the
        // microphone is actually dead.
        try {
          recognition.abort();
        } catch {
          // already stopped
        }
        scheduleRestart(retryDelay(recognitionErrorsRef.current));
      };
      recognition.onend = () => {
        recognitionActiveRef.current = false;
        if (!activeRef.current) return;
        bargedRef.current = false;
        // A normal hand-off restarts almost immediately so the user can speak
        // the moment Mira's sentence ends. Errors use a short backoff.
        scheduleRestart(retryDelay(recognitionErrorsRef.current));
      };
      recognitionRef.current = recognition;
      recognition.start();
      setMicState('ready');
    } catch {
      recognitionActiveRef.current = false;
      recognitionErrorsRef.current += 1;
      if (activeRef.current && recognitionErrorsRef.current <= 3) {
        scheduleRestart(250);
        return;
      }
      noticeRef.current('语音识别启动失败，请用文字聊天。');
      activeRef.current = false;
      setListening(false);
      setMicState('unavailable');
      cleanupMedia();
    }
  }, [cleanupMedia, isAgentEcho, scheduleRestart]);
  beginRef.current = beginRecognition;

  const startLevelMeter = useCallback((stream: MediaStream) => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4.2));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const start = useCallback(async (bargeIn = true) => {
    if (activeRef.current) return;
    if (bargeIn) onBargeIn();
    activeRef.current = true;
    recognitionErrorsRef.current = 0;
    bargedRef.current = false;
    setListening(true);
    setMicState('requesting');
    setEchoMode('unknown');
    setInterim('');

    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      noticeRef.current('当前浏览器没有麦克风接口，可以继续用文字聊天。');
      activeRef.current = false;
      setListening(false);
      setMicState('unavailable');
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({
          audio: {
            echoCancellation: { exact: 'all' } as unknown as boolean,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
        });
      } catch (error) {
        const constraint = (error as any)?.constraint;
        if (!(error instanceof Error) || error.name !== 'OverconstrainedError' || constraint !== 'echoCancellation') {
          throw error;
        }
        stream = await media.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            channelCount: 1,
          },
        });
      }
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setEchoMode(echoModeOf(stream));
      setMicState('ready');
      startLevelMeter(stream);
      beginRecognition();
    } catch {
      noticeRef.current('麦克风不可用或权限被拒绝，可以继续用文字聊天。');
      activeRef.current = false;
      setListening(false);
      setMicState('denied');
      cleanupMedia();
    }
  }, [beginRecognition, cleanupMedia, onBargeIn, startLevelMeter]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      cleanupMedia();
    };
  }, [cleanupMedia]);

  return {
    listening,
    level,
    interim,
    echoMode,
    micState,
    start,
    stop,
    forcedStop: stop,
  };
}

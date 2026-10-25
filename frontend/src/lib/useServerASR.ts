import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeAgentEcho } from './echoGuard';

type Options = {
  onBargeIn: () => void;
  onResult: (text: string) => void;
  onNotice: (message: string) => void;
  onUnavailable?: () => void;
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

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/asr`;
}

function to16k(input: Float32Array, inputRate: number): Float32Array {
  const ratio = inputRate / 16000;
  if (Math.abs(ratio - 1) < 0.001) return input;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const base = Math.floor(position);
    const next = Math.min(input.length - 1, base + 1);
    const fraction = position - base;
    output[i] = (input[base] ?? 0) * (1 - fraction) + (input[next] ?? 0) * fraction;
  }
  return output;
}

function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767);
  }
  return pcm;
}

/**
 * Server-side Tencent ASR. The important difference from browser Web Speech is
 * that this uses the same AEC-processed getUserMedia stream we monitor locally,
 * and does not restart the recognizer between Mira's turns. That removes both
 * the "listening but deaf" gap and most TTS self-echo.
 */
export function useServerASR({
  onBargeIn,
  onResult,
  onNotice,
  onUnavailable,
  agentText,
  agentSpeaking,
}: Options) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [echoMode, setEchoMode] = useState<EchoMode>('unknown');
  const [micState, setMicState] = useState<MicState>('idle');
  const activeRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const pcmBufferRef = useRef<Int16Array>(new Int16Array(0));
  const bargedRef = useRef(false);
  const echoModeRef = useRef<EchoMode>('unknown');
  const agentSpeakingRef = useRef(false);
  const agentLinesRef = useRef<Array<{ text: string; at: number }>>([]);
  const speechEndedAtRef = useRef(0);
  const onBargeInRef = useRef(onBargeIn);
  onBargeInRef.current = onBargeIn;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

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
    if (!agentSpeakingRef.current && now - speechEndedAtRef.current > 1500) return false;
    return agentLinesRef.current.some(
      (line) => now - line.at < 20000 && looksLikeAgentEcho(text, line.text),
    );
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLevel(0);
  }, []);

  const releaseAudio = useCallback(() => {
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    pcmBufferRef.current = new Int16Array(0);
  }, [stopLevelMeter]);

  const stop = useCallback(() => {
    activeRef.current = false;
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'stop' }));
      } catch {
        // already closing
      }
      socket.close();
    }
    releaseAudio();
    setListening(false);
    setInterim('');
    setMicState('idle');
    bargedRef.current = false;
  }, [releaseAudio]);

  const markUnavailable = useCallback((message: string) => {
    noticeRef.current(message);
    activeRef.current = false;
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const socket = wsRef.current;
    wsRef.current = null;
    try {
      socket?.close();
    } catch {
      // ignore
    }
    releaseAudio();
    setListening(false);
    setInterim('');
    setMicState('unavailable');
    unavailableRef.current?.();
  }, [releaseAudio]);

  const handleMessage = useCallback(
    (raw: string) => {
      let message: any;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.type === 'asr.ready') {
        setMicState('ready');
        return;
      }
      if (message.type === 'asr.error') {
        if (message.recoverable === false) {
          markUnavailable(message.message || '语音识别不可用');
        } else {
          setInterim('');
          noticeRef.current(message.message || '语音识别暂时中断，正在重连');
        }
        return;
      }
      if (message.type !== 'asr.partial' && message.type !== 'asr.final') return;
      const text = String(message.text ?? '').trim();
      if (!text) return;
      if (isAgentEcho(text)) {
        setInterim('');
        return;
      }
      if (message.type === 'asr.partial') {
        setInterim(text.slice(-120));
        const meaningful = text.replace(/[\s，。！？!?、,.]/g, '');
        if (meaningful.length >= 2 && !bargedRef.current) {
          bargedRef.current = true;
          onBargeInRef.current();
        }
        return;
      }
      bargedRef.current = false;
      setInterim('');
      onResultRef.current(text);
    },
    [isAgentEcho, markUnavailable],
  );

  const connectSocket = useCallback(() => {
    if (!activeRef.current) return;
    if (intentionalCloseRef.current) return;
    const socket = new WebSocket(websocketUrl());
    wsRef.current = socket;
    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      reconnectAttemptsRef.current = 0;
      setMicState('ready');
      socket.send(JSON.stringify({ type: 'start' }));
    };
    socket.onmessage = (event) => {
      if (wsRef.current !== socket) return;
      handleMessage(String(event.data ?? ''));
    };
    socket.onclose = () => {
      if (wsRef.current !== socket) return;
      wsRef.current = null;
      setInterim('');
      if (!activeRef.current || intentionalCloseRef.current) return;
      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > 4) {
        markUnavailable('语音识别连接失败，已切换识别方式');
        return;
      }
      if (reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectSocket();
      }, 900);
    };
    socket.onerror = () => {
      // onclose schedules the retry
    };
  }, [handleMessage, markUnavailable]);

  const pushPcm = useCallback((samples: Float32Array, sampleRate: number) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // If AEC is unavailable, do not feed the recognizer while Mira speaks.
    // Otherwise her own TTS becomes a user turn. Chrome normally reports all
    // or standard here; the text overlap guard is the second layer.
    if (
      agentSpeakingRef.current
      && echoModeRef.current !== 'all'
      && echoModeRef.current !== 'standard'
    ) {
      pcmBufferRef.current = new Int16Array(0);
      return;
    }
    const pcm = toPcm16(to16k(samples, sampleRate));
    const previous = pcmBufferRef.current;
    const combined = new Int16Array(previous.length + pcm.length);
    combined.set(previous);
    combined.set(pcm, previous.length);
    let offset = 0;
    while (combined.length - offset >= 1600) {
      const chunk = combined.slice(offset, offset + 1600);
      offset += 1600;
      try {
        socket.send(chunk.buffer);
      } catch {
        break;
      }
    }
    pcmBufferRef.current = offset ? combined.slice(offset) : combined;
  }, []);

  const start = useCallback(async (bargeIn = false) => {
    if (activeRef.current) return;
    if (bargeIn) onBargeInRef.current();
    activeRef.current = true;
    intentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;
    bargedRef.current = false;
    setListening(true);
    setInterim('');
    setMicState('requesting');
    setEchoMode('unknown');
    echoModeRef.current = 'unknown';

    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      markUnavailable('当前浏览器无法访问麦克风，请用文字聊天');
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
        if (!(error instanceof Error) || error.name !== 'OverconstrainedError') throw error;
        stream = await media.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
        });
      }
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mode = echoModeOf(stream);
      echoModeRef.current = mode;
      setEchoMode(mode);
      if (mode === 'unavailable') {
        noticeRef.current('回声消除不可用，Mira 说话时麦克风会暂停一会；她说完即可继续。');
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) throw new Error('AudioContext unavailable');
      let ctx: AudioContext;
      try {
        ctx = new AudioCtx({ sampleRate: 16000 });
      } catch {
        ctx = new AudioCtx();
      }
      ctxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const silent = ctx.createGain();
      silent.gain.value = 0;
      silent.connect(ctx.destination);

      let node: AudioWorkletNode | ScriptProcessorNode | null = null;
      if (ctx.audioWorklet) {
        try {
          const code = `
            class MiraPcmWorklet extends AudioWorkletProcessor {
              process(inputs) {
                const channel = inputs[0] && inputs[0][0];
                if (channel) {
                  const copy = new Float32Array(channel.length);
                  copy.set(channel);
                  this.port.postMessage(copy.buffer, [copy.buffer]);
                }
                return true;
              }
            }
            registerProcessor('mira-pcm', MiraPcmWorklet);
          `;
          const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const worklet = new AudioWorkletNode(ctx, 'mira-pcm', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          worklet.port.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              pushPcm(new Float32Array(event.data), ctx.sampleRate);
            }
          };
          source.connect(worklet);
          worklet.connect(silent);
          node = worklet;
        } catch {
          node = null;
        }
      }
      if (!node) {
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          pushPcm(event.inputBuffer.getChannelData(0), ctx.sampleRate);
        };
        source.connect(processor);
        processor.connect(silent);
        node = processor;
      }
      nodeRef.current = node;

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!activeRef.current) return;
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
      connectSocket();
    } catch {
      markUnavailable('麦克风不可用或权限被拒绝，可以继续用文字聊天');
    }
  }, [connectSocket, markUnavailable, pushPcm]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);

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

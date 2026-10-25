import { useRef, useState, type CSSProperties } from 'react';
import { MicIcon, SendIcon } from './Icons';

type Props = {
  phase: string;
  connected: boolean;
  listening: boolean;
  level: number;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  onMicStart: () => void;
  onMicStop: () => void;
  onSuggestion: (value: string) => void;
  showSuggestions: boolean;
  mode: 'mock' | 'live';
};

const SUGGESTIONS = ['你在等谁？', '给我看看你拍的照片。', '刚才那道闪电，你看到了吗？'];

export default function Controls({
  phase,
  connected,
  listening,
  level,
  draft,
  onDraft,
  onSend,
  onMicStart,
  onMicStop,
  onSuggestion,
  showSuggestions,
  mode,
}: Props) {
  const composingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const canType = connected && phase !== 'entry' && phase !== 'ended';
  const placeholder = !connected
    ? '正在回到咖啡馆…'
    : phase === 'speaking'
      ? listening
        ? '想打断她？直接说，或点击麦克风…'
        : '点击麦克风可以打断她，也可以等她说完…'
      : phase === 'thinking'
        ? '她正在想，也可以换一句…'
        : listening
          ? '说点什么，或者直接开口…'
          : '点击麦克风继续说话，也可以直接打字…';

  return (
    <div className={`controls ${focused ? 'focused' : ''}`}>
      {showSuggestions && !listening && (
        <div className="suggestions" aria-label="可以这样问">
          <span className="suggestions-label">试着问她</span>
          {SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="suggestion" onClick={() => onSuggestion(text)}>
              {text}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          onSend(draft);
        }}
      >
        <button
          type="button"
          className={`mic ${listening ? 'is-listening' : ''}`}
          style={{ '--level': Math.max(0.12, level) } as CSSProperties}
          onClick={() => (listening ? onMicStop() : onMicStart())}
          disabled={!canType}
          aria-pressed={listening}
          aria-label={listening ? '关闭持续聆听' : '开启持续聆听'}
        >
          <span className="mic-ring" />
          <MicIcon />
        </button>

        <div className="input-wrap">
          <input
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
                event.preventDefault();
                if (draft.trim()) onSend(draft);
              }
            }}
            placeholder={placeholder}
            enterKeyHint="send"
            disabled={!canType}
            maxLength={500}
            aria-label="输入想对 Mira 说的话"
          />
          <span className="input-hint">{listening ? '持续聆听中' : phase === 'speaking' ? '点击麦克风打断' : '点击麦克风'}</span>
        </div>

        <button type="submit" className="send" disabled={!canType || !draft.trim()} aria-label="发送">
          <SendIcon />
        </button>
      </form>

      <div className="under-hint">
        <span>{connected ? (mode === 'live' ? 'LIVE · 真实模型' : 'MOCK · 无需 API Key') : '连接中'}</span>
        <span className="dot">·</span>
        <span>{listening ? '持续聆听中 · 直接说话' : '点击麦克风开启持续聆听'}</span>
      </div>
    </div>
  );
}

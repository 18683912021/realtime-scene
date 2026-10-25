type Props = {
  text: string;
  progress: number;
  captions: boolean;
  visible: boolean;
};

function splitText(text: string): string[] {
  const matches = text.match(/[^。！？!?…，,]+[。！？!?…，,]?/g);
  return matches?.filter(Boolean) ?? (text ? [text] : []);
}

export default function Subtitle({ text, progress, captions, visible }: Props) {
  if (!captions || !visible || !text) return null;
  const parts = splitText(text);
  const active = Math.max(0, Math.min(parts.length - 1, Math.floor(progress * parts.length)));
  return (
    <div className="subtitle-wrap" aria-live="polite">
      <div className="subtitle-name">
        <span className="subtitle-dot" />
        MIRA
      </div>
      <p className="subtitle">
        {parts.map((part, index) => (
          <span
            key={`${part}-${index}`}
            className={index === active ? 'part active' : index < active ? 'part past' : 'part future'}
          >
            {part}
          </span>
        ))}
      </p>
    </div>
  );
}

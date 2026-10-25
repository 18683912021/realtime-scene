import { useState } from 'react';
import type { MediaEvent } from '../lib/types';
import { StarIcon } from './Icons';

type Props = {
  media: MediaEvent;
  onClose: () => void;
};

export default function MediaCard({ media, onClose }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="media-layer" role="dialog" aria-label={media.caption || 'Mira 的照片'}>
      <div className="media-card">
        <div className="media-tape" />
        <button type="button" className="media-close" onClick={onClose} aria-label="关闭照片">
          ×
        </button>
        <div className="media-frame">
          {failed ? (
            <div className="media-fallback" role="status">
              <StarIcon size={26} />
              <span>照片没有加载出来</span>
            </div>
          ) : media.type === 'video' ? (
            <video src={media.url} autoPlay muted loop playsInline onError={() => setFailed(true)} />
          ) : (
            <img src={media.url} alt={media.caption || '雨夜的照片'} onError={() => setFailed(true)} />
          )}
          <div className="media-sheen" />
        </div>
        <div className="media-footer">
          <span className="media-caption">{media.caption || '那天，雨比今晚还大。'}</span>
          <span className="media-mark">MIRA / 04:17</span>
        </div>
      </div>
    </div>
  );
}

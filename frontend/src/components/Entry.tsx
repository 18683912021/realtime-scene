import { SparkIcon } from './Icons';

type Props = {
  connecting: boolean;
  mode: 'mock' | 'live';
  renderer: 'vrm' | 'svg' | 'live2d';
  onStart: () => void;
};

export default function Entry({ connecting, mode, renderer, onStart }: Props) {
  return (
    <div className="entry-screen">
      <div className="entry-top">
        <span className="entry-kicker">
          <SparkIcon /> AN INTERACTIVE SCENE
        </span>
        <span className="entry-mode">{renderer === 'live2d' ? 'LIVE2D MODE' : renderer === 'vrm' ? `ORIGINAL 3D · ${mode === 'live' ? 'LIVE' : 'MOCK'}` : 'ORIGINAL · SVG'}</span>
      </div>
      <div className="entry-body">
        <p className="entry-eyebrow">午后 · 雨刚停</p>
        <h1>
          雨停
          <span>之前</span>
        </h1>
        <p className="entry-copy">
          午后的光落进落地窗。
          <br />
          银白短发的旅行摄影师 Mira
          <br />
          靠在窗边，桌上有一杯拿铁和一台旧相机。
        </p>
        <button type="button" className="enter-button" onClick={onStart} disabled={connecting}>
          <span>{connecting ? '正在推门…' : '推门进去'}</span>
          <span className="enter-arrow">→</span>
        </button>
        <p className="entry-note">Mira 是 AI 朋友 · 语音由云端实时识别 · 对话会发送给模型服务<br />建议打开声音 · 直接说话就能开始 · 3–5 分钟</p>
      </div>
      <div className="entry-footer">
        <span>MIRA / 27 / 旅行摄影师</span>
        <span>01</span>
      </div>
    </div>
  );
}

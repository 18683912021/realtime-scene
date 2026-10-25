import type { CSSProperties, RefObject } from 'react';
import Character from './Character';
import type { Action, Emotion, Phase, SceneName } from '../lib/types';

type Props = {
  renderer: 'vrm' | 'svg' | 'live2d';
  live2dModel: string;
  scene: SceneName;
  camera: 'none' | 'push_in';
  fx: 'none' | 'lightning';
  fxNonce: number;
  phase: Phase;
  emotion: Emotion;
  action: Action;
  audioLevelRef: RefObject<number>;
  voiceLevel: number;
};

export default function Scene({
  renderer,
  live2dModel,
  scene,
  camera,
  fx,
  fxNonce,
  phase,
  emotion,
  action,
  audioLevelRef,
  voiceLevel,
}: Props) {
  return (
    <div
      className={`scene scene-${scene} camera-${camera} state-${phase}`}
      style={{ '--voice': voiceLevel.toFixed(3) } as CSSProperties}
    >
      <div className="scene-bg">
        <img className="scene-photo" src="/assets/backgrounds/cafe_urban.webp" alt="" />
        <div className="scene-photo-light" />
        <div className="sunbeam sunbeam-a" />
        <div className="sunbeam sunbeam-b" />
        <div className="scene-vignette" />
        <div className="scene-grain" />

        {fx === 'lightning' && (
          <div key={fxNonce} className="lightning-flash" aria-hidden="true">
            <svg viewBox="0 0 400 700" preserveAspectRatio="none">
              <path d="M248 0 L210 152 L252 146 L190 320 L230 310 L148 700 L220 402 L182 412 L266 198 L226 208 Z" fill="#fff6d9" />
            </svg>
          </div>
        )}
      </div>

      <div className={`state-aura state-aura-${phase}`} aria-hidden="true" />

      {phase === 'listening' && (
        <img
          className="state-fx state-fx-listening"
          src="/assets/state/listening.webp"
          alt=""
          draggable={false}
        />
      )}
      {phase === 'speaking' && (
        <img
          className="state-fx state-fx-speaking"
          src="/assets/state/speaking.webp"
          alt=""
          draggable={false}
        />
      )}

      <Character
        renderer={renderer}
        modelUrl={live2dModel}
        phase={phase}
        emotion={emotion}
        action={action}
        audioLevelRef={audioLevelRef}
      />

      {phase === 'thinking' && (
        <img
          className="state-fx state-fx-thinking"
          src="/assets/state/thinking.webp"
          alt=""
          draggable={false}
        />
      )}
    </div>
  );
}

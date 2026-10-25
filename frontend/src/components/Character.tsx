import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Action, Emotion, Phase } from '../lib/types';
import Mira from './Mira';
import VrmCharacter from './VrmCharacter';

type Props = {
  phase: Phase;
  emotion: Emotion;
  action: Action;
  renderer: 'vrm' | 'svg' | 'live2d';
  modelUrl: string;
  audioLevelRef: RefObject<number>;
};

const EMOTION_MOTION: Record<Emotion, [string, number]> = {
  soft: ['Idle', 0],
  guarded: ['Tap', 0],
  surprised: ['Flick', 0],
};

let corePromise: Promise<void> | null = null;

function loadCubismCore(): Promise<void> {
  if ((window as any).Live2DCubismCore) return Promise.resolve();
  if (!corePromise) {
    corePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/live2dcubismcore.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Cubism Core failed to load'));
      document.head.appendChild(script);
    });
  }
  return corePromise;
}

const ACTION_MOTION: Record<Action, [string, number]> = {
  none: ['Idle', 0],
  wipe_lens: ['Tap', 0],
  look_window: ['Flick', 0],
  step_back: ['Flick', 0],
};

export default function Character({ phase, emotion, action, renderer, modelUrl, audioLevelRef }: Props) {
  const [failed, setFailed] = useState(false);
  if (renderer === 'vrm' && !failed) {
    return (
      <VrmCharacter
        phase={phase}
        emotion={emotion}
        action={action}
        audioLevelRef={audioLevelRef}
        onFailure={() => setFailed(true)}
      />
    );
  }
  if (renderer === 'svg' || failed) {
    return <Mira phase={phase} emotion={emotion} action={action} />;
  }
  return (
    <Live2DCharacter
      phase={phase}
      emotion={emotion}
      action={action}
      modelUrl={modelUrl}
      audioLevelRef={audioLevelRef}
      onFailure={() => setFailed(true)}
    />
  );
}

function Live2DCharacter({
  phase,
  emotion,
  action,
  modelUrl,
  audioLevelRef,
  onFailure,
}: Omit<Props, 'renderer'> & { onFailure: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const appRef = useRef<any>(null);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const emotionRef = useRef(emotion);
  emotionRef.current = emotion;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      try {
        await loadCubismCore();
        const PIXI = await import('pixi.js');
        (window as any).PIXI = PIXI;
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        const host = hostRef.current;
        if (!host || cancelled) return;
        const app = new PIXI.Application({
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
          autoDensity: true,
          width: host.clientWidth || 420,
          height: host.clientHeight || 640,
        });
        host.appendChild(app.view as HTMLCanvasElement);
        const model = await Live2DModel.from(modelUrl, {
          autoInteract: false,
          autoUpdate: true,
        });
        if (cancelled) {
          model.destroy();
          app.destroy(true);
          return;
        }
        app.stage.addChild(model);
        model.anchor.set(0.5, 1);
        // Cache the unscaled size: model.height changes after we scale, and
        // recomputing from it would make ResizeObserver compound the zoom.
        const baseHeight = Math.max(1, model.height || model.internalModel.height || 640);
        const fit = () => {
          const w = host.clientWidth || 420;
          const h = host.clientHeight || 640;
          app.renderer.resize(w, h);
          // Show head + upper body, letting the lower body crop below the
          // stage. The model is a full-body sample, not a bust asset.
          const scale = (h * 1.35) / baseHeight;
          model.scale.set(scale);
          model.x = w * 0.51;
          model.y = h * 0.08 + baseHeight * scale;
        };
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(host);
        void Promise.resolve(model.motion('Idle', 0, 2)).catch(() => {});
        modelRef.current = model;
        appRef.current = app;
        setReady(true);
      } catch (error) {
        console.error('Live2D load failed', error);
        if (!cancelled) failureRef.current();
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      modelRef.current?.destroy();
      appRef.current?.destroy(true);
      modelRef.current = null;
      appRef.current = null;
    };
  }, [modelUrl]);

  useEffect(() => {
    if (!ready || !modelRef.current) return;
    try {
      const [group, index] = action !== 'none' ? ACTION_MOTION[action] : EMOTION_MOTION[emotion];
      void Promise.resolve(modelRef.current.motion(group, index, 3)).catch(() => {});
    } catch {
      // Motion groups differ between custom models; keep idle alive.
    }
  }, [emotion, action, ready]);

  // Give each interaction phase its own body language. The hook runs after
  // motions/physics have been evaluated but before the model updates, so the
  // offsets blend with the idle animation instead of fighting it.
  useEffect(() => {
    if (!ready || !modelRef.current) return;
    const internal = modelRef.current.internalModel;
    const core = internal.coreModel;
    const reading = (id: string) => {
      try {
        return core.getParameterValueById(id) || 0;
      } catch {
        return 0;
      }
    };
    const write = (id: string, value: number) => {
      try {
        core.setParameterValueById(id, value);
      } catch {
        // Parameter sets vary between sample models.
      }
    };
    const pose = {
      angleX: 0,
      angleY: 0,
      angleZ: 0,
      bodyX: 0,
      bodyZ: 0,
      eyeX: 0,
      eyeY: 0,
      brow: 0,
      browAngle: 0,
      mouth: 0,
      mouthForm: 0.08,
    };
    let last = performance.now();
    const apply = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const current = phaseRef.current;
      const t = now / 1000;
      let target = {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        bodyX: 0,
        bodyZ: 0,
        eyeX: 0,
        eyeY: 0,
        brow: 0,
        browAngle: 0,
        mouth: 0,
        mouthForm: 0.08,
      };

      if (current === 'listening') {
        target = {
          angleX: 3.5,
          angleY: -2.5 + Math.sin(t * 1.15) * 1.2,
          angleZ: -6.5 + Math.sin(t * 0.9) * 1.1,
          bodyX: 2.6,
          bodyZ: -1.2,
          eyeX: 0.28,
          eyeY: -0.08,
          brow: 0.16,
          browAngle: -0.08,
          mouth: 0.02,
          mouthForm: 0.22,
        };
      } else if (current === 'thinking') {
        target = {
          angleX: -3.5,
          angleY: 6.5 + Math.sin(t * 1.05) * 1.4,
          angleZ: 6.5 + Math.sin(t * 0.8) * 1.1,
          bodyX: -1.8,
          bodyZ: 1.1,
          eyeX: -0.48,
          eyeY: 0.58,
          brow: 0.28,
          browAngle: 0.16,
          mouth: 0.01,
          mouthForm: -0.12,
        };
      } else if (current === 'speaking') {
        const level = audioLevelRef.current;
        const fallback = 0.1 + 0.07 * Math.abs(Math.sin(t * 7.4)) + 0.05 * Math.abs(Math.sin(t * 3.1));
        const open = level > 0.012 ? level : fallback;
        target = {
          angleX: Math.sin(t * 2.15) * 2.2,
          angleY: Math.sin(t * 1.55) * 1.5,
          angleZ: Math.sin(t * 1.75 + 0.4) * 1.9,
          bodyX: Math.sin(t * 1.45) * 1.7,
          bodyZ: Math.sin(t * 1.1) * 0.9,
          eyeX: 0.12 + Math.sin(t * 0.7) * 0.1,
          eyeY: Math.sin(t * 0.55) * 0.08,
          brow: 0.1,
          browAngle: 0.04,
          mouth: 0.06 + open * 0.88,
          mouthForm: 0.16,
        };
      }

      const emotion = emotionRef.current;
      if (emotion === 'surprised') {
        target.angleX -= 4;
        target.angleY -= 3;
        target.angleZ += 3;
        target.bodyX -= 3;
        target.brow += 0.35;
        target.browAngle += 0.12;
        target.mouth = Math.max(target.mouth, 0.14);
        target.mouthForm = -0.18;
      } else if (emotion === 'guarded') {
        target.angleX -= 1.5;
        target.angleZ += 2;
        target.browAngle -= 0.1;
        target.mouthForm -= 0.12;
      }

      const ease = (rate: number) => 1 - Math.exp(-rate * dt);
      pose.angleX += (target.angleX - pose.angleX) * ease(5.5);
      pose.angleY += (target.angleY - pose.angleY) * ease(5.5);
      pose.angleZ += (target.angleZ - pose.angleZ) * ease(5.5);
      pose.bodyX += (target.bodyX - pose.bodyX) * ease(4.2);
      pose.bodyZ += (target.bodyZ - pose.bodyZ) * ease(4.2);
      pose.eyeX += (target.eyeX - pose.eyeX) * ease(7);
      pose.eyeY += (target.eyeY - pose.eyeY) * ease(7);
      pose.brow += (target.brow - pose.brow) * ease(5);
      pose.browAngle += (target.browAngle - pose.browAngle) * ease(5);
      // Faster attack for speech, slower release so the jaw doesn't chatter.
      const mouthRate = target.mouth > pose.mouth ? 26 : 11;
      pose.mouth += (target.mouth - pose.mouth) * ease(mouthRate);
      pose.mouthForm += (target.mouthForm - pose.mouthForm) * ease(6);

      write('ParamAngleX', reading('ParamAngleX') + pose.angleX);
      write('ParamAngleY', reading('ParamAngleY') + pose.angleY);
      write('ParamAngleZ', reading('ParamAngleZ') + pose.angleZ);
      write('ParamBodyAngleX', reading('ParamBodyAngleX') + pose.bodyX);
      write('ParamBodyAngleZ', reading('ParamBodyAngleZ') + pose.bodyZ);
      write('ParamEyeBallX', reading('ParamEyeBallX') + pose.eyeX);
      write('ParamEyeBallY', reading('ParamEyeBallY') + pose.eyeY);
      write('ParamBrowLY', reading('ParamBrowLY') + pose.brow);
      write('ParamBrowRY', reading('ParamBrowRY') + pose.brow);
      write('ParamBrowLAngle', reading('ParamBrowLAngle') + pose.browAngle);
      write('ParamBrowRAngle', reading('ParamBrowRAngle') - pose.browAngle);
      write('ParamMouthOpenY', Math.max(0, Math.min(1, pose.mouth)));
      write('ParamA', Math.max(0, Math.min(1, pose.mouth)));
      write('ParamMouthForm', pose.mouthForm);
    };
    internal.on('beforeModelUpdate', apply);
    return () => {
      internal.off('beforeModelUpdate', apply);
      try {
        core.setParameterValueById('ParamMouthOpenY', 0);
      } catch {
        // ignore
      }
    };
  }, [ready, audioLevelRef, modelUrl]);

  return (
    <div className={`mira live2d phase-${phase} emotion-${emotion} action-${action}`}>
      <div className="live2d-host" ref={hostRef} />
      <div className="live2d-rim" />
      {!ready && <div className="live2d-loading">正在唤醒 Mira…</div>}
    </div>
  );
}

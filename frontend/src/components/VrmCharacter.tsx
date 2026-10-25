import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Action, Emotion, Phase } from '../lib/types';

type Props = {
  phase: Phase;
  emotion: Emotion;
  action: Action;
  audioLevelRef: RefObject<number>;
  onFailure: () => void;
};

const VRM_URL = '/vrm/AvatarSample_A.vrm';

/**
 * A real-time 3D anime character rendered with three-vrm.
 *
 * VRoid's AvatarSample_A is used as an original adult base. The hair texture
 * is re-tinted to silver at runtime, the T-pose is relaxed into a café stance,
 * and the face/body are animated from the same phase/emotion/audio contract
 * as the 2D renderers.
 */
export default function VrmCharacter({ phase, emotion, action, audioLevelRef, onFailure }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const emotionRef = useRef(emotion);
  emotionRef.current = emotion;
  const actionRef = useRef(action);
  actionRef.current = action;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let cleanup = () => {};

    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
        const host = hostRef.current;
        if (!host || cancelled) return;

        const width = Math.max(1, host.clientWidth || 520);
        const height = Math.max(1, host.clientHeight || 760);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
        camera.position.set(0, 1.34, 2.32);
        camera.lookAt(0, 1.2, 0);

        scene.add(new THREE.HemisphereLight(0xfff2dd, 0x53606f, 1.42));
        const key = new THREE.DirectionalLight(0xffd9a8, 1.38);
        key.position.set(2.2, 3.2, 2.8);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xb8d8f2, 0.95);
        rim.position.set(-2.4, 2.2, -1.6);
        scene.add(rim);
        const windowRim = new THREE.DirectionalLight(0xffc88f, 0.9);
        windowRim.position.set(2.5, 2.35, -1.3);
        scene.add(windowRim);
        const fill = new THREE.DirectionalLight(0xfff4e6, 0.38);
        fill.position.set(0, 1.8, 3);
        scene.add(fill);
        const faceFill = new THREE.DirectionalLight(0xffe7d0, 0.58);
        faceFill.position.set(0.6, 1.7, 2.2);
        scene.add(faceFill);

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.loadAsync(VRM_URL);
        if (cancelled) return;
        const vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        VRMUtils.rotateVRM0(vrm);
        vrm.scene.traverse((object: any) => {
          object.frustumCulled = false;
        });

        const processedTextures = new Map<string, any>();
        const makeCanvasTexture = (
          source: any,
          key: string,
          paint: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, image: any) => void,
        ) => {
          const cacheKey = `${source.uuid}:${key}`;
          const cached = processedTextures.get(cacheKey);
          if (cached) return cached;
          const image = source.image;
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          if (!context) return null;
          context.drawImage(image, 0, 0);
          paint(context, canvas, image);
          const texture = new THREE.CanvasTexture(canvas);
          texture.flipY = source.flipY;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = source.wrapS;
          texture.wrapT = source.wrapT;
          texture.minFilter = source.minFilter;
          texture.magFilter = source.magFilter;
          texture.needsUpdate = true;
          processedTextures.set(cacheKey, texture);
          return texture;
        };
        const useTexture = (material: any, texture: any) => {
          if (!texture) return;
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        };

        // Keep the model's strand texture but move the brown hair to a cool
        // silver; a flat material would lose the hand-painted VRoid highlights.
        const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

        // Keep the model's hand-painted strand highlights, but remap the brown
        // values into a silver-lavender range with darker roots. A flat
        // brightness filter erased the hair's depth and made it look chalky.
        vrm.scene.traverse((object: any) => {
          if (!object.isMesh) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material?.name?.includes('HAIR') || !material.map?.image) continue;
            const source = material.map;
            const texture = makeCanvasTexture(source, 'silver-hair', (context, canvas, image) => {
              const frame = context.getImageData(0, 0, canvas.width, canvas.height);
              const data = frame.data;
              for (let i = 0; i < data.length; i += 4) {
                if (!data[i + 3]) continue;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                const shade = Math.pow(lum, 1.12);
                const cool = 1 - shade;
                data[i] = clampByte(84 + 170 * shade - 4 * cool);
                data[i + 1] = clampByte(96 + 158 * shade + 2 * cool);
                data[i + 2] = clampByte(122 + 136 * shade + 10 * cool);
              }
              context.putImageData(frame, 0, 0);
              context.globalCompositeOperation = 'source-atop';
              const sheen = context.createLinearGradient(0, 0, canvas.width * 0.4, canvas.height);
              sheen.addColorStop(0, 'rgba(255,255,255,0.1)');
              sheen.addColorStop(0.45, 'rgba(198,224,255,0.08)');
              sheen.addColorStop(1, 'rgba(58,72,105,0.1)');
              context.fillStyle = sheen;
              context.fillRect(0, 0, canvas.width, canvas.height);
            });
            useTexture(material, texture);
          }
        });

        // Build a deeper blue iris while preserving the original eye UVs and
        // alpha mask. The sample's brown iris has a gold bloom that turned
        // green under hue-rotate; this keeps a controlled warm inner ring.
        vrm.scene.traverse((object: any) => {
          if (!object.isMesh) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material?.name?.includes('EyeIris') || !material.map?.image) continue;
            const source = material.map;
            const texture = makeCanvasTexture(source, 'mira-iris', (context, canvas) => {
              const width = canvas.width;
              const height = canvas.height;
              const eyes = [
                { cx: width * 0.2534, cy: height * 0.4941, rx: width * 0.1065, ry: height * 0.278 },
                { cx: width * 0.745, cy: height * 0.4941, rx: width * 0.1065, ry: height * 0.278 },
              ];
              const frame = context.getImageData(0, 0, width, height);
              const data = frame.data;
              for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                  const i = (y * width + x) * 4;
                  const alpha = data[i + 3];
                  if (alpha < 6) continue;
                  const eye = Math.abs(x - eyes[0].cx) < Math.abs(x - eyes[1].cx) ? eyes[0] : eyes[1];
                  const dx = (x - eye.cx) / eye.rx;
                  const dy = (y - eye.cy) / eye.ry;
                  const radius = Math.hypot(dx, dy);
                  if (radius > 1.06) {
                    data[i + 3] = 0;
                    continue;
                  }
                  const vertical = Math.max(0, Math.min(1, (dy + 1) / 2));
                  const angle = Math.atan2(dy, dx);
                  const fiber = 0.92 + 0.07 * Math.sin(angle * 28 + radius * 16) + 0.035 * Math.sin(angle * 6 - radius * 8);
                  let r = (30 + 42 * vertical) * fiber;
                  let g = (65 + 55 * vertical) * fiber;
                  let b = (112 + 58 * vertical) * fiber;
                  const lift = Math.max(0, 1 - Math.hypot((dx + 0.35) / 1.2, (dy + 0.45) / 1.05));
                  r += 26 * lift;
                  g += 34 * lift;
                  b += 40 * lift;
                  if (radius < 0.3) {
                    r = 5;
                    g = 6;
                    b = 9;
                  } else if (radius < 0.38) {
                    r = 196;
                    g = 159;
                    b = 103;
                  }
                  if (radius > 0.79) {
                    const rim = 0.2 + 0.8 * (1 - radius) / 0.27;
                    r *= rim;
                    g *= rim;
                    b *= rim;
                  }
                  data[i] = clampByte(r);
                  data[i + 1] = clampByte(g);
                  data[i + 2] = clampByte(b);
                  data[i + 3] = clampByte(alpha * Math.min(1, (1.06 - radius) / 0.06));
                }
              }
              context.putImageData(frame, 0, 0);
              context.globalCompositeOperation = 'source-atop';
              for (const eye of eyes) {
                const glow = context.createRadialGradient(
                  eye.cx - eye.rx * 0.26,
                  eye.cy - eye.ry * 0.34,
                  0,
                  eye.cx - eye.rx * 0.26,
                  eye.cy - eye.ry * 0.34,
                  eye.rx * 0.26,
                );
                glow.addColorStop(0, 'rgba(255,255,255,0.95)');
                glow.addColorStop(0.5, 'rgba(224,243,255,0.34)');
                glow.addColorStop(1, 'rgba(224,243,255,0)');
                context.fillStyle = glow;
                context.beginPath();
                context.ellipse(eye.cx - eye.rx * 0.26, eye.cy - eye.ry * 0.34, eye.rx * 0.25, eye.ry * 0.16, -0.35, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = 'rgba(242,252,255,0.68)';
                context.beginPath();
                context.ellipse(eye.cx + eye.rx * 0.22, eye.cy + eye.ry * 0.14, eye.rx * 0.075, eye.ry * 0.05, -0.3, 0, Math.PI * 2);
                context.fill();
              }
            });
            useTexture(material, texture);
          }
        });

        // Face texture: warm the very pale VRoid skin, deepen the shadows a
        // touch and add a restrained blush. The face texture also contains the
        // hair silhouette, so this stays subtle enough not to tint the hair.
        vrm.scene.traverse((object: any) => {
          if (!object.isMesh) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const name = material?.name ?? '';
            if (!material?.map?.image) continue;
            const source = material.map;
            if (name.includes('Face') && name.includes('SKIN')) {
              const texture = makeCanvasTexture(source, 'warm-face', (context, canvas) => {
                const frame = context.getImageData(0, 0, canvas.width, canvas.height);
                const data = frame.data;
                for (let i = 0; i < data.length; i += 4) {
                  if (!data[i + 3]) continue;
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];
                  const lum = (r + g + b) / 765;
                  data[i] = clampByte((r - 128) * 1.045 + 128 + 3 + lum * 3);
                  data[i + 1] = clampByte((g - 128) * 1.035 + 128 - 1);
                  data[i + 2] = clampByte((b - 128) * 1.02 + 128 - 3);
                }
                context.putImageData(frame, 0, 0);
                context.globalCompositeOperation = 'source-atop';
                context.fillStyle = 'rgba(246,184,150,0.06)';
                context.fillRect(0, 0, canvas.width, canvas.height);
                const side = context.createLinearGradient(0, 0, canvas.width, 0);
                side.addColorStop(0, 'rgba(150,92,82,0.05)');
                side.addColorStop(0.18, 'rgba(150,92,82,0)');
                side.addColorStop(0.82, 'rgba(150,92,82,0)');
                side.addColorStop(1, 'rgba(150,92,82,0.05)');
                context.fillStyle = side;
                context.fillRect(0, 0, canvas.width, canvas.height);
                for (const cx of [0.34, 0.66]) {
                  const blush = context.createRadialGradient(
                    canvas.width * cx,
                    canvas.height * 0.625,
                    0,
                    canvas.width * cx,
                    canvas.height * 0.625,
                    canvas.width * 0.13,
                  );
                  blush.addColorStop(0, 'rgba(232,112,118,0.11)');
                  blush.addColorStop(0.55, 'rgba(232,116,120,0.043)');
                  blush.addColorStop(1, 'rgba(232,116,120,0)');
                  context.fillStyle = blush;
                  context.fillRect(0, 0, canvas.width, canvas.height);
                }
                context.save();
                for (const cx of [0.35, 0.65]) {
                  context.save();
                  context.translate(canvas.width * cx, canvas.height * 0.515);
                  context.scale(1, 0.42);
                  const shadow = context.createRadialGradient(0, 0, 0, 0, 0, canvas.width * 0.105);
                  shadow.addColorStop(0, 'rgba(108,74,78,0.032)');
                  shadow.addColorStop(0.7, 'rgba(118,82,84,0.014)');
                  shadow.addColorStop(1, 'rgba(118,82,84,0)');
                  context.fillStyle = shadow;
                  context.fillRect(-canvas.width, -canvas.width, canvas.width * 2, canvas.width * 2);
                  context.restore();
                }
                context.restore();
                context.save();
                context.translate(canvas.width * 0.5, canvas.height * 0.63);
                context.scale(0.5, 1);
                const nose = context.createRadialGradient(0, 0, 0, 0, 0, canvas.width * 0.05);
                nose.addColorStop(0, 'rgba(132,90,78,0.028)');
                nose.addColorStop(1, 'rgba(132,90,78,0)');
                context.fillStyle = nose;
                context.fillRect(-canvas.width, -canvas.width, canvas.width * 2, canvas.width * 2);
                context.restore();
              });
              useTexture(material, texture);
            } else if (name.includes('FaceMouth')) {
              const texture = makeCanvasTexture(source, 'warm-lips', (context, canvas, image) => {
                context.globalCompositeOperation = 'source-atop';
                context.filter = 'saturate(1.42) brightness(0.955) contrast(1.05)';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                context.filter = 'none';
                context.fillStyle = 'rgba(188,70,84,0.085)';
                context.fillRect(0, 0, canvas.width, canvas.height);
              });
              useTexture(material, texture);
              material.color.set(0xffb5aa);
            } else if (name.includes('FaceBrow')) {
              const texture = makeCanvasTexture(source, 'ash-brow', (context, canvas, image) => {
                context.globalCompositeOperation = 'source-atop';
                context.filter = 'grayscale(0.74) brightness(0.56) contrast(1.15)';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                context.filter = 'none';
              });
              useTexture(material, texture);
            } else if (name.includes('FaceEyeline') || name.includes('FaceEyelash')) {
              const texture = makeCanvasTexture(source, 'cool-liner', (context, canvas, image) => {
                context.globalCompositeOperation = 'source-atop';
                context.filter = 'brightness(0.62) saturate(0.48) contrast(1.2)';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                context.filter = 'none';
              });
              useTexture(material, texture);
            } else if (name.includes('EyeHighlight')) {
              const texture = makeCanvasTexture(source, 'cool-highlight', (context, canvas, image) => {
                context.globalCompositeOperation = 'source-atop';
                context.filter = 'grayscale(1) brightness(1.22)';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                context.filter = 'none';
              });
              useTexture(material, texture);
              material.color.set(0xeaf8ff);
            } else if (name.includes('Tops')) {
              // The cardigan texture is mostly a warm off-white with a blue
              // ribbon and brass buttons. Preserve those marks, but map the
              // fabric itself to a deep indigo denim with visible twill.
              const texture = makeCanvasTexture(source, 'denim', (context, canvas) => {
                const width = canvas.width;
                const frame = context.getImageData(0, 0, width, canvas.height);
                const data = frame.data;
                for (let i = 0; i < data.length; i += 4) {
                  if (!data[i + 3]) continue;
                  const r = data[i];
                  const g = data[i + 1];
                  const b = data[i + 2];
                  if (b > r + 15) continue;
                  if (r - b > 55 && r > 135) continue;
                  const x = (i / 4) % width;
                  const y = Math.floor(i / 4 / width);
                  const lum = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
                  const tone = Math.pow(lum, 0.92);
                  const twill = 1 + 0.022 * Math.sin((x + y) * 0.62) + 0.012 * Math.sin(x * 0.21 - y * 0.47);
                  data[i] = clampByte((29 + 57 * tone) * twill);
                  data[i + 1] = clampByte((43 + 69 * tone) * twill);
                  data[i + 2] = clampByte((70 + 86 * tone) * twill);
                }
                context.putImageData(frame, 0, 0);
              });
              useTexture(material, texture);
            } else if (name.includes('Body_00_SKIN')) {
              const texture = makeCanvasTexture(source, 'warm-body', (context, canvas) => {
                const frame = context.getImageData(0, 0, canvas.width, canvas.height);
                const data = frame.data;
                for (let i = 0; i < data.length; i += 4) {
                  if (!data[i + 3]) continue;
                  data[i] = clampByte(data[i] * 0.985 + 4);
                  data[i + 1] = clampByte(data[i + 1] * 0.97 + 1);
                  data[i + 2] = clampByte(data[i + 2] * 0.965);
                }
                context.putImageData(frame, 0, 0);
              });
              useTexture(material, texture);
            }
          }
        });

        // Keep the sample's baked unlit look. This is the anime-flat style the
        // product used before the PBR experiment; the texture work above adds
        // detail without turning her into a plastic 3D figurine.
        scene.add(vrm.scene);
        const humanoid = vrm.humanoid;
        const bone = (name: string) => humanoid?.getNormalizedBoneNode(name) ?? null;
        const setBone = (name: string, x: number, y: number, z: number) => {
          const node = bone(name);
          if (node) node.rotation.set(x, y, z);
        };
        setBone('leftUpperArm', 0.16, 0, 0.58);
        setBone('leftLowerArm', 0.12, 0, 1.28);
        setBone('leftHand', 0, 0, 0.3);
        setBone('rightUpperArm', 0.1, 0, -1.18);
        setBone('rightLowerArm', 0.08, 0, -0.14);
        setBone('rightHand', 0, 0, -0.04);
        const hips = bone('hips');
        if (hips) hips.rotation.y = -0.14;

        // The sample's loose cardigan reads wider than Mira's reference. A
        // small non-uniform scale keeps the same mesh and flat style while
        // narrowing the upper body and sleeve volume.
        const scaleBone = (name: string, x: number, y: number, z: number) => {
          const node = bone(name);
          if (node) node.scale.set(x, y, z);
        };
        scaleBone('upperChest', 0.92, 1, 1);
        scaleBone('chest', 0.93, 1, 1);
        scaleBone('spine', 0.96, 1, 1);
        for (const name of ['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm']) {
          scaleBone(name, 0.94, 1, 0.94);
        }

        // Let the eyes settle on the person in front of her instead of
        // staring through them. A slightly offset target keeps the gaze from
        // looking robotic; during thought she glances up and away.
        const gazeTarget = new THREE.Object3D();
        gazeTarget.position.set(0.1, 1.42, 2.2);
        scene.add(gazeTarget);
        const lookAt = (vrm as any).lookAt;
        if (lookAt) lookAt.target = gazeTarget;

        const expressions = vrm.expressionManager;
        const values = {
          blink: 0,
          mouth: 0,
          happy: 0,
          relaxed: 0,
          surprised: 0,
          angry: 0,
        };
        let nextBlink = 2.5;
        let blinkStart = -1;
        let doubleBlinkAt = -1;
        const clock = new THREE.Clock();

        const animate = () => {
          if (cancelled) return;
          frame = requestAnimationFrame(animate);
          const delta = Math.min(0.05, clock.getDelta());
          const time = clock.elapsedTime;
          const currentPhase = phaseRef.current;
          const currentEmotion = emotionRef.current;
          const currentAction = actionRef.current;

          // Head and upper-body acting. A permanent tiny sway keeps her from
          // freezing into a mannequin while the state-specific acting layers
          // on top of it.
          let targetHeadX = 0.018;
          let targetHeadY = 0.12;
          let targetHeadZ = 0.028;
          let targetNeckX = 0;
          let targetChestY = 0;
          if (currentPhase === 'listening') {
            targetHeadX = 0.035 + Math.sin(time * 1.45) * 0.01;
            targetHeadY = 0.1;
            targetHeadZ = -0.06;
            targetNeckX = 0.02;
          } else if (currentPhase === 'thinking') {
            targetHeadX = -0.075;
            targetHeadY = 0.035;
            targetHeadZ = 0.07;
            targetNeckX = -0.03;
          } else if (currentPhase === 'speaking') {
            targetHeadX = Math.sin(time * 2.1) * 0.022 + Math.min(0.02, audioLevelRef.current * 0.035);
            targetHeadY = 0.1 + Math.sin(time * 1.3) * 0.018;
            targetHeadZ = Math.sin(time * 1.6) * 0.02;
          }
          targetHeadX += Math.sin(time * 0.83) * 0.005;
          targetHeadY += Math.sin(time * 0.47) * 0.014;
          targetHeadZ += Math.sin(time * 0.61) * 0.006;
          if (currentEmotion === 'surprised') {
            targetHeadX -= 0.1;
            targetHeadZ += 0.06;
            targetChestY -= 0.06;
          }
          if (currentEmotion === 'guarded') {
            targetHeadX += 0.03;
            targetHeadY -= 0.09;
            targetHeadZ += 0.04;
            targetChestY += 0.08;
          }
          if (currentAction === 'look_window') {
            targetHeadY -= 0.12;
            targetHeadZ += 0.035;
          }
          if (currentAction === 'step_back') targetHeadX -= 0.04;

          const smooth = 1 - Math.exp(-delta * 6.5);
          const armSmooth = 1 - Math.exp(-delta * 5.5);
          const leftUpper = bone('leftUpperArm');
          const leftLower = bone('leftLowerArm');
          const leftHand = bone('leftHand');
          const rightUpper = bone('rightUpperArm');
          const rightLower = bone('rightLowerArm');
          const rightHand = bone('rightHand');
          const wiping = currentAction === 'wipe_lens';
          // Left hand rests on the hip; the lens gesture uses the right hand.
          if (leftUpper) {
            leftUpper.rotation.x = 0.16 + Math.sin(time * 0.9) * 0.007;
            leftUpper.rotation.z += (1.16 - leftUpper.rotation.z) * armSmooth;
          }
          if (leftLower) leftLower.rotation.z += (0.12 - leftLower.rotation.z) * armSmooth;
          if (leftHand) leftHand.rotation.z += (0.2 - leftHand.rotation.z) * armSmooth;
          if (rightUpper) {
            rightUpper.rotation.x = 0.1 + Math.sin(time * 0.78 + 1.1) * 0.006;
            rightUpper.rotation.z += ((wiping ? -0.52 : -1.18) - rightUpper.rotation.z) * armSmooth;
          }
          if (rightLower) rightLower.rotation.z += ((wiping ? -1.08 : -0.14) - rightLower.rotation.z) * armSmooth;
          if (rightHand) rightHand.rotation.z += ((wiping ? -0.2 : -0.04) - rightHand.rotation.z) * armSmooth;
          const head = bone('head');
          const neck = bone('neck');
          const chest = bone('chest');
          if (head) {
            head.rotation.x += (targetHeadX - head.rotation.x) * smooth;
            head.rotation.y += (targetHeadY - head.rotation.y) * smooth;
            head.rotation.z += (targetHeadZ - head.rotation.z) * smooth;
          }
          if (neck) neck.rotation.x += (targetNeckX - neck.rotation.x) * smooth;
          if (chest) {
            chest.rotation.x = Math.sin(time * 1.15) * 0.008 - (currentEmotion === 'surprised' ? 0.05 : 0);
            chest.rotation.y += (targetChestY - chest.rotation.y) * smooth;
            chest.rotation.z = Math.sin(time * 0.57) * 0.006;
          }
          if (hips) {
            hips.rotation.z = Math.sin(time * 0.8) * 0.008 + (currentAction === 'step_back' ? 0.025 : 0);
            hips.rotation.y = -0.14 + Math.sin(time * 0.31) * 0.018;
          }

          const gazingAway = currentPhase === 'thinking' || currentAction === 'look_window';
          const gazeX = gazingAway ? 0.5 : 0.1 + Math.sin(time * 0.37) * 0.035;
          const gazeY = currentPhase === 'thinking' ? 1.62 : 1.42;
          gazeTarget.position.x += (gazeX - gazeTarget.position.x) * smooth;
          gazeTarget.position.y += (gazeY - gazeTarget.position.y) * smooth;

          // Blink every few seconds, with an occasional double blink.
          if (time > nextBlink) {
            blinkStart = time;
            nextBlink = time + 3.2 + Math.random() * 3.8;
            if (Math.random() < 0.24) doubleBlinkAt = time + 0.27;
          }
          let blink = 0;
          const blinkPhase = (time - blinkStart) / 0.16;
          if (blinkPhase >= 0 && blinkPhase <= 1) blink = Math.sin(blinkPhase * Math.PI);
          if (doubleBlinkAt > 0) {
            const secondPhase = (time - doubleBlinkAt) / 0.16;
            if (secondPhase >= 0 && secondPhase <= 1) {
              blink = Math.max(blink, Math.sin(secondPhase * Math.PI) * 0.82);
            } else if (secondPhase > 1) {
              doubleBlinkAt = -1;
            }
          }
          values.blink += (blink - values.blink) * Math.min(1, delta * 30);

          // Lip sync: real TTS RMS when available, a quiet speech envelope as
          // the fallback. The audio level is already smoothed by the session.
          const level = audioLevelRef.current;
          const fallback = 0.14 + 0.12 * Math.abs(Math.sin(time * 9.2)) + 0.08 * Math.abs(Math.sin(time * 4.1));
          const mouthTarget = currentPhase === 'speaking' ? Math.min(1, Math.max(fallback, level * 1.2)) : 0;
          const mouthRate = mouthTarget > values.mouth ? 24 : 12;
          values.mouth += (mouthTarget - values.mouth) * (1 - Math.exp(-delta * mouthRate));

          // The sample's "joy" preset is mapped to happy and narrows the eyes
          // into a sleepy slit. "fun" is mapped to relaxed, which keeps the
          // eyes open; use that for the default small smile and reserve happy
          // for a brief accent.
          const happyTarget = currentEmotion === 'soft' ? 0.055 : 0;
          const relaxedTarget = currentEmotion === 'soft'
            ? (currentPhase === 'speaking' ? 0.48 : 0.4)
            : currentEmotion === 'guarded' ? 0.3 : 0;
          const surprisedTarget = currentEmotion === 'surprised' ? 1 : 0;
          const angryTarget = currentEmotion === 'guarded' ? 0.1 : 0;
          // A hard reset avoids the old smile lingering during the lightning beat.
          if (currentEmotion === 'surprised') {
            values.happy = 0;
            values.relaxed = 0;
            values.angry = 0;
          }
          values.happy += (happyTarget - values.happy) * (1 - Math.exp(-delta * 4));
          values.relaxed += (relaxedTarget - values.relaxed) * (1 - Math.exp(-delta * 4));
          values.surprised += (surprisedTarget - values.surprised) * (1 - Math.exp(-delta * 12));
          values.angry += (angryTarget - values.angry) * (1 - Math.exp(-delta * 4));

          expressions?.setValue('blink', values.blink);
          expressions?.setValue('aa', values.mouth);
          expressions?.setValue('happy', values.happy);
          expressions?.setValue('relaxed', values.relaxed);
          expressions?.setValue('Surprised', values.surprised);
          expressions?.setValue('angry', values.angry);

          vrm.update(delta);
          renderer.render(scene, camera);
        };

        const resize = () => {
          const w = Math.max(1, host.clientWidth || width);
          const h = Math.max(1, host.clientHeight || height);
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        setReady(true);
        animate();

        cleanup = () => {
          cancelled = true;
          cancelAnimationFrame(frame);
          observer.disconnect();
          try {
            VRMUtils.deepDispose(vrm.scene);
          } catch {
            // ignore
          }
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (error) {
        console.error('VRM load failed', error);
        if (!cancelled) failureRef.current();
      }
    })();

    return () => cleanup();
  }, [audioLevelRef]);

  return (
    <div
      className={`mira vrm phase-${phase} emotion-${emotion} action-${action}`}
      role="img"
      aria-label="Mira，银白短发的成年旅行摄影师"
    >
      <div className="vrm-host" ref={hostRef} />
      {!ready && <div className="vrm-loading">Mira 正在推门…</div>}
    </div>
  );
}

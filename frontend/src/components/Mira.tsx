import type { Action, Emotion, Phase } from '../lib/types';

type Props = {
  phase: Phase;
  emotion: Emotion;
  action: Action;
};

function Star({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? size : size * 0.42;
    points.push(`${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`);
  }
  return <polygon points={points.join(' ')} fill={fill} />;
}

/**
 * Mira — an original adult character, drawn as a layered vector portrait.
 *
 * Adult cues: a longer jaw, almond eyes, defined nose/cheekbones, subtle
 * makeup, collarbones and contemporary streetwear. Layers are split into
 * body / head / side hair / fringe / pupils / mouth so the scene can animate
 * breathing, gaze, blinking and speech without a third-party character model.
 */
export default function Mira({ phase, emotion, action }: Props) {
  const guarded = emotion === 'guarded';
  const surprised = emotion === 'surprised';
  const looking = action === 'look_window';
  const pupilX = looking ? -3 : guarded ? 2.2 : phase === 'thinking' ? -2 : phase === 'listening' ? 1 : 0;
  const pupilY = phase === 'thinking' ? -2.2 : phase === 'listening' ? 0.7 : surprised ? -1 : 0;

  return (
    <div className={`mira phase-${phase} emotion-${emotion} action-${action}`}>
      <div className="mira-glow" />
      <svg
        viewBox="0 0 600 840"
        role="img"
        aria-label="Mira，银白短发的成年旅行摄影师，穿白色 T 恤和牛仔外套"
      >
        <defs>
          <linearGradient id="miraHairBack" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#f7faff" />
            <stop offset="0.34" stopColor="#cfdaea" />
            <stop offset="0.7" stopColor="#9fb3d0" />
            <stop offset="1" stopColor="#6f86a6" />
          </linearGradient>
          <linearGradient id="miraHairFront" x1="0" y1="0" x2="0.75" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.38" stopColor="#e4ecf7" />
            <stop offset="0.76" stopColor="#b9c8de" />
            <stop offset="1" stopColor="#8298b8" />
          </linearGradient>
          <linearGradient id="miraHairShade" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0" stopColor="#6f86a6" stopOpacity="0.65" />
            <stop offset="0.55" stopColor="#9fb3d0" stopOpacity="0.26" />
            <stop offset="1" stopColor="#f7fbff" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="miraSkin" x1="0.18" y1="0" x2="0.82" y2="1">
            <stop offset="0" stopColor="#fbe6d4" />
            <stop offset="0.5" stopColor="#f3d2b8" />
            <stop offset="1" stopColor="#dda98c" />
          </linearGradient>
          <linearGradient id="miraSkinShade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c88d72" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="#dda88e" stopOpacity="0.08" />
            <stop offset="1" stopColor="#a96054" stopOpacity="0.38" />
          </linearGradient>
          <linearGradient id="miraTee" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="0.55" stopColor="#f1ece2" />
            <stop offset="1" stopColor="#d2c9ba" />
          </linearGradient>
          <linearGradient id="miraDenim" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#8faaca" />
            <stop offset="0.48" stopColor="#5e7fa4" />
            <stop offset="1" stopColor="#35506f" />
          </linearGradient>
          <linearGradient id="miraDenimDark" x1="0" y1="0" x2="1" y2="0.8">
            <stop offset="0" stopColor="#4b6a8d" />
            <stop offset="1" stopColor="#263c55" />
          </linearGradient>
          <radialGradient id="miraIris" cx="0.38" cy="0.32" r="0.78">
            <stop offset="0" stopColor="#a9e0f4" />
            <stop offset="0.36" stopColor="#5eaad3" />
            <stop offset="0.76" stopColor="#2a6f9e" />
            <stop offset="1" stopColor="#173d5c" />
          </radialGradient>
          <radialGradient id="miraLens" cx="0.34" cy="0.3" r="0.82">
            <stop offset="0" stopColor="#d7edf2" />
            <stop offset="0.24" stopColor="#7ea6b3" />
            <stop offset="0.62" stopColor="#263e4a" />
            <stop offset="1" stopColor="#09151c" />
          </radialGradient>
          <linearGradient id="miraLeather" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6b4a3e" />
            <stop offset="1" stopColor="#2b1b19" />
          </linearGradient>
          <linearGradient id="miraGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4d9a0" />
            <stop offset="1" stopColor="#b77936" />
          </linearGradient>
          <linearGradient id="miraRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6df" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff6df" stopOpacity="0" />
          </linearGradient>
          <filter id="miraSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="miraSoftSmall" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          <clipPath id="miraFaceClip">
            <path d="M300 150 C252 150 232 184 232 230 C232 272 242 306 260 332 C274 350 288 362 300 362 C312 362 326 350 340 332 C358 306 368 272 368 230 C368 184 348 150 300 150Z" />
          </clipPath>
          <clipPath id="miraTeeClip">
            <path d="M174 462 C194 434 224 420 250 414 C258 452 276 470 300 476 C324 470 342 452 350 414 C376 420 406 434 426 462 L458 840 L142 840Z" />
          </clipPath>
        </defs>

        <ellipse cx="306" cy="470" rx="210" ry="290" fill="#7c5a3e" opacity="0.1" filter="url(#miraSoft)" />
        <ellipse cx="300" cy="818" rx="150" ry="22" fill="#2b170c" opacity="0.28" filter="url(#miraSoftSmall)" />

        <g className="mira-body">
          <g className="mira-hair-back">
            <path
              d="M300 94 C230 94 182 152 186 240 C188 292 180 332 172 378 C164 426 176 474 204 508 L226 488 C210 450 210 406 220 370 L380 370 C390 406 390 450 374 488 L396 508 C424 474 436 426 428 378 C420 332 412 292 414 240 C418 152 370 94 300 94Z"
              fill="url(#miraHairBack)"
            />
            <path
              d="M300 110 C240 110 196 164 200 246 C202 292 194 330 186 374 C180 416 190 458 210 486 L224 476 C212 438 212 398 222 364 L378 364 C388 398 388 438 376 476 L390 486 C410 458 420 416 414 374 C406 330 398 292 400 246 C404 164 360 110 300 110Z"
              fill="url(#miraHairShade)"
              opacity="0.34"
            />
            <path d="M212 180 C190 236 188 310 198 378 C206 432 224 478 248 508" fill="none" stroke="#8599b7" strokeWidth="2.2" opacity="0.3" />
            <path d="M388 180 C410 236 412 310 402 378 C394 432 376 478 352 508" fill="none" stroke="#7f93b1" strokeWidth="2.2" opacity="0.26" />
            <path d="M226 468 C212 432 212 390 222 356" fill="none" stroke="#f7fbff" strokeWidth="3" opacity="0.36" />
            <path d="M300 106 C298 138 301 168 308 192" fill="none" stroke="#7589a6" strokeWidth="2.4" opacity="0.42" />
            <path d="M246 142 C270 124 300 118 328 126" fill="none" stroke="#7f93b1" strokeWidth="2" opacity="0.28" />
          </g>

          {/* neck + collarbone */}
          <path d="M270 334 L330 334 L340 422 C322 438 278 438 260 422Z" fill="url(#miraSkin)" />
          <path d="M272 340 C280 388 292 412 300 418 C308 412 320 388 328 340Z" fill="#dba184" opacity="0.36" />
          <path d="M260 422 C278 440 322 440 340 422" fill="none" stroke="#c48770" strokeWidth="2" opacity="0.42" />
          <path d="M256 460 C266 450 280 446 294 450 M344 460 C334 450 320 446 306 450" fill="none" stroke="#c98e77" strokeWidth="1.8" opacity="0.3" />

          {/* chest skin in the tee scoop */}
          <path
            d="M260 404 C252 446 268 476 300 484 C332 476 348 446 340 404 C362 410 378 422 388 438 C362 480 238 480 212 438 C222 422 238 410 260 404Z"
            fill="url(#miraSkin)"
          />
          <path d="M300 430 L300 480" fill="none" stroke="#c88f78" strokeWidth="1.4" opacity="0.22" />

          {/* white crew-neck tee; the higher neckline keeps the portrait adult */}
          <path
            d="M258 402 C262 426 280 440 300 444 C320 440 338 426 342 402 C364 408 380 420 390 436 C364 458 236 458 210 436 C220 420 236 408 258 402Z"
            fill="url(#miraTee)"
          />
          <path d="M258 402 C266 428 282 440 300 444 C318 440 334 428 342 402" fill="none" stroke="#d6cec1" strokeWidth="2" opacity="0.7" />
          <path
            d="M174 462 C194 434 224 420 250 414 C258 452 276 470 300 476 C324 470 342 452 350 414 C376 420 406 434 426 462 L458 840 L142 840Z"
            fill="url(#miraTee)"
          />
          <g clipPath="url(#miraTeeClip)">
            <path d="M142 560 C184 538 220 550 240 592 C208 620 170 630 140 620Z" fill="#cfc6b7" opacity="0.3" />
            <path d="M458 600 C420 574 388 584 360 626 C392 656 424 666 458 654Z" fill="#bdb2a0" opacity="0.26" />
            <path d="M218 500 C234 570 230 660 214 758" fill="none" stroke="#c9bdad" strokeWidth="2.2" opacity="0.32" />
            <path d="M382 512 C368 584 372 666 390 770" fill="none" stroke="#bdb2a0" strokeWidth="2.2" opacity="0.28" />
          </g>

          {/* denim jacket panels */}
          <path
            d="M174 462 C158 480 148 512 142 554 L130 840 L252 840 L264 548 C250 506 238 470 226 432 C210 440 190 450 174 462Z"
            fill="url(#miraDenim)"
          />
          <path
            d="M426 462 C442 480 452 512 458 554 L470 840 L348 840 L336 548 C350 506 362 470 374 432 C390 440 410 450 426 462Z"
            fill="url(#miraDenim)"
          />
          <path d="M226 432 C240 422 252 410 260 396 L244 378 C230 394 216 410 204 424Z" fill="url(#miraDenimDark)" />
          <path d="M374 432 C360 422 348 410 340 396 L356 378 C370 394 384 410 396 424Z" fill="url(#miraDenimDark)" />
          <path d="M174 462 C160 486 148 526 142 566 L128 760 C136 778 154 782 166 768 L178 584 C184 534 194 494 208 466Z" fill="url(#miraDenimDark)" />
          <path d="M426 462 C440 486 452 526 458 566 L472 760 C464 778 446 782 434 768 L422 584 C416 534 406 494 392 466Z" fill="url(#miraDenimDark)" />

          <g fill="none" stroke="#d9c6a2" strokeWidth="1.6" opacity="0.6">
            <path d="M158 506 C166 566 168 666 164 780" strokeDasharray="5 6" />
            <path d="M442 506 C434 566 432 666 436 780" strokeDasharray="5 6" />
            <path d="M192 566 L236 552 L242 624 L198 638Z" />
            <path d="M408 566 L364 552 L358 624 L402 638Z" />
          </g>
          <g fill="#e4d6b7" opacity="0.75">
            <circle cx="222" cy="566" r="3" />
            <circle cx="378" cy="566" r="3" />
            <circle cx="222" cy="646" r="3" />
            <circle cx="378" cy="646" r="3" />
          </g>

          {/* denim collar framing the neck */}
          <path d="M226 432 C232 404 244 384 262 372 L284 392 C266 406 252 422 244 444Z" fill="url(#miraDenimDark)" />
          <path d="M374 432 C368 404 356 384 338 372 L316 392 C334 406 348 422 356 444Z" fill="url(#miraDenimDark)" />
          <path d="M262 372 C274 360 288 354 300 354 C312 354 326 360 338 372 L318 388 C310 380 306 378 300 378 C294 378 290 380 282 388Z" fill="#d9e3f2" opacity="0.55" />
          <path d="M262 372 C276 382 288 388 300 390 C312 388 324 382 338 372" fill="none" stroke="#e8dcc4" strokeWidth="1.4" opacity="0.4" />

          {/* camera strap */}
          <path d="M222 440 C242 506 258 566 270 606" fill="none" stroke="url(#miraLeather)" strokeWidth="12" strokeLinecap="round" />
          <path d="M378 440 C358 506 342 566 330 606" fill="none" stroke="url(#miraLeather)" strokeWidth="12" strokeLinecap="round" />
          <path d="M222 440 C242 506 258 566 270 606" fill="none" stroke="#c49a71" strokeWidth="1.3" opacity="0.45" />
          <path d="M378 440 C358 506 342 566 330 606" fill="none" stroke="#c49a71" strokeWidth="1.3" opacity="0.4" />

          {/* hands + vintage camera */}
          <path d="M258 698 C246 684 244 662 258 650 C270 640 286 644 292 658 L306 694 L282 718Z" fill="url(#miraSkin)" />
          <path d="M342 698 C354 684 356 662 342 650 C330 640 314 644 308 658 L294 694 L318 718Z" fill="url(#miraSkin)" />
          <rect x="258" y="596" width="112" height="88" rx="13" fill="#3b3633" />
          <rect x="264" y="602" width="100" height="76" rx="10" fill="url(#miraLeather)" opacity="0.5" />
          <path d="M258 618 L370 618" stroke="#b88f5d" strokeWidth="1.8" opacity="0.45" />
          <circle cx="314" cy="644" r="31" fill="#1b1c1e" />
          <circle cx="314" cy="644" r="25" fill="#2d353a" />
          <circle cx="314" cy="644" r="19" fill="url(#miraLens)" />
          <circle cx="307" cy="637" r="5" fill="#e9f7fa" opacity="0.85" />
          <circle cx="324" cy="654" r="2.4" fill="#9fd3de" opacity="0.6" />
          <rect x="268" y="584" width="26" height="15" rx="3" fill="#2e2927" />
          <circle cx="350" cy="600" r="7" fill="#c7a266" />
          <circle cx="350" cy="600" r="3.4" fill="#6e4f2f" />
          <path d="M292 700 C306 710 326 710 338 700" fill="none" stroke="#7a3e36" strokeWidth="2" opacity="0.28" />

          {/* narrow side locks sit behind the face so they frame, not cover it */}
          <g className="mira-hair-front">
            <path
              d="M240 190 C224 238 224 302 234 362 C238 392 246 416 254 434 L268 420 C256 388 250 350 252 306 C254 260 260 222 272 192Z"
              fill="url(#miraHairFront)"
            />
            <path
              d="M360 190 C376 238 376 302 366 362 C362 392 354 416 346 434 L332 420 C344 388 350 350 348 306 C346 260 340 222 328 192Z"
              fill="url(#miraHairFront)"
            />
            <path d="M242 220 C230 268 230 326 238 382" fill="none" stroke="#8fa3c0" strokeWidth="2" opacity="0.3" />
            <path d="M358 220 C370 268 370 326 362 382" fill="none" stroke="#8fa3c0" strokeWidth="2" opacity="0.3" />
          </g>

          <g className="mira-head">
            <path
              d="M300 150 C252 150 232 184 232 230 C232 272 242 306 260 332 C274 350 288 362 300 362 C312 362 326 350 340 332 C358 306 368 272 368 230 C368 184 348 150 300 150Z"
              fill="url(#miraSkin)"
            />
            <g clipPath="url(#miraFaceClip)">
              <path
                d="M232 230 C232 184 252 150 300 150 C278 164 264 192 262 230 C260 272 268 314 286 346 C272 334 242 296 232 230Z"
                fill="url(#miraSkinShade)"
                opacity="0.5"
              />
              <path
                d="M368 230 C368 184 348 150 300 150 C322 164 336 192 338 230 C340 272 332 314 314 346 C328 334 358 296 368 230Z"
                fill="#b97563"
                opacity="0.16"
              />
              <path
                d="M236 220 C248 198 266 188 288 192 C314 196 340 212 358 236 L358 258 C330 242 296 238 262 248 C248 252 240 244 236 236Z"
                fill="#6d4d58"
                opacity="0.16"
                filter="url(#miraSoftSmall)"
              />
              <ellipse cx="300" cy="354" rx="34" ry="9" fill="#b97563" opacity="0.18" filter="url(#miraSoftSmall)" />
            </g>

            {/* ears */}
            <path d="M232 246 C222 242 216 252 220 268 C224 282 232 286 236 278Z" fill="url(#miraSkin)" />
            <path d="M368 246 C378 242 384 252 380 268 C376 282 368 286 364 278Z" fill="url(#miraSkin)" />
            <path d="M226 258 C222 262 223 270 227 274" fill="none" stroke="#c58d77" strokeWidth="1.6" opacity="0.5" />
            <path d="M374 258 C378 262 377 270 373 274" fill="none" stroke="#c58d77" strokeWidth="1.6" opacity="0.5" />
            <circle cx="224" cy="278" r="2" fill="#e5c07b" />
            <circle cx="376" cy="278" r="2" fill="#e5c07b" />

            {/* brows */}
            <g fill="none" strokeLinecap="round">
              <path
                d={guarded ? 'M240 230 C252 238 266 238 280 232' : surprised ? 'M240 220 C252 212 266 212 280 220' : 'M240 227 C252 219 266 219 280 227'}
                stroke="#6f7f97"
                strokeWidth="4.2"
                opacity="0.9"
              />
              <path
                d={guarded ? 'M360 230 C348 238 334 238 320 232' : surprised ? 'M360 220 C348 212 334 212 320 220' : 'M360 227 C348 219 334 219 320 227'}
                stroke="#6f7f97"
                strokeWidth="4.2"
                opacity="0.9"
              />
            </g>

            {/* eyes */}
            <g className="mira-eyes">
              <path d="M240 256 C248 244 262 241 274 249 C279 253 279 261 273 266 C261 274 248 270 240 263Z" fill="#fffaf2" />
              <path d="M360 256 C352 244 338 241 326 249 C321 253 321 261 327 266 C339 274 352 270 360 263Z" fill="#fffaf2" />
              <g className="mira-pupils" transform={`translate(${pupilX} ${pupilY})`}>
                <circle cx="258" cy="255" r="9.7" fill="url(#miraIris)" />
                <circle cx="342" cy="255" r="9.7" fill="url(#miraIris)" />
                <circle cx="258" cy="255" r="3.9" fill="#16222e" />
                <circle cx="342" cy="255" r="3.9" fill="#16222e" />
                <circle cx="254.4" cy="251.4" r="2.3" fill="#ffffff" />
                <circle cx="338.4" cy="251.4" r="2.3" fill="#ffffff" />
                <circle cx="261" cy="259" r="1.4" fill="#c9f4ff" opacity="0.8" />
                <circle cx="345" cy="259" r="1.4" fill="#c9f4ff" opacity="0.8" />
              </g>
              <path d="M239 254 C248 243 264 240 276 248" fill="none" stroke="#1f2937" strokeWidth="3.6" strokeLinecap="round" />
              <path d="M361 254 C352 243 336 240 324 248" fill="none" stroke="#1f2937" strokeWidth="3.6" strokeLinecap="round" />
              <path d="M242 265 C252 271 264 274 274 269" fill="none" stroke="#b87f6d" strokeWidth="1.3" opacity="0.4" />
              <path d="M358 265 C348 271 336 274 326 269" fill="none" stroke="#b87f6d" strokeWidth="1.3" opacity="0.4" />
              <path d="M244 246 C256 238 270 238 280 244" fill="none" stroke="#d2a08d" strokeWidth="1.2" opacity="0.5" />
              <path d="M356 246 C344 238 330 238 320 244" fill="none" stroke="#d2a08d" strokeWidth="1.2" opacity="0.5" />
            </g>

            {/* nose */}
            <path d="M300 274 C298 286 296 294 300 300 C303 303 307 302 309 299" fill="none" stroke="#c18871" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
            <path d="M297 282 C299 279 302 279 304 281" fill="none" stroke="#fff4e8" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
            <path d="M308 300 C311 301 313 300 315 298" fill="none" stroke="#b57662" strokeWidth="1.3" opacity="0.3" />

            {/* mouth variants */}
            <g className="mira-mouth">
              <path className="mira-mouth-smile" d="M286 320 C293 329 307 329 314 320" fill="none" stroke="#b5686b" strokeWidth="3.4" strokeLinecap="round" />
              <path className="mira-mouth-smile" d="M290 323 C296 327 304 327 310 323" fill="none" stroke="#f0b3ad" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
              <path className="mira-mouth-flat" d="M288 322 L312 322" fill="none" stroke="#a75f63" strokeWidth="3.2" strokeLinecap="round" />
              <g className="mira-mouth-open">
                <ellipse cx="300" cy="323" rx="11" ry="7.5" fill="#7c3f45" />
                <path d="M290 326 C296 332 304 332 310 326" fill="#d98b8f" opacity="0.75" />
                <path d="M289 319 C295 317 305 317 311 319" fill="none" stroke="#8e4a50" strokeWidth="1.4" opacity="0.7" />
              </g>
            </g>

            <ellipse cx="252" cy="295" rx="15" ry="7" fill="#eb9589" opacity="0.16" filter="url(#miraSoftSmall)" />
            <ellipse cx="348" cy="295" rx="15" ry="7" fill="#eb9589" opacity="0.16" filter="url(#miraSoftSmall)" />
            <circle cx="350" cy="301" r="1.3" fill="#8f5f55" opacity="0.55" />

            <path
              d="M238 198 C252 178 274 168 300 170 C328 172 350 186 362 206 C338 194 312 192 290 200 C270 208 252 222 244 238Z"
              fill="#6d4d58"
              opacity="0.12"
              filter="url(#miraSoftSmall)"
            />
          </g>

          {/* fringe is drawn above the face so the forehead is not bare */}
          <g className="mira-fringe">
            <path
              d="M300 114 C250 114 218 148 218 198 C218 216 224 232 232 244 C238 216 250 192 268 176 C286 160 314 156 336 168 C354 178 366 198 372 222 C378 208 380 192 376 178 C366 140 338 114 300 114Z"
              fill="url(#miraHairFront)"
            />
            <path
              d="M240 196 C252 164 278 148 310 150 C338 152 358 164 368 186 C348 168 324 162 302 172 C280 182 260 202 248 224 C242 216 238 208 240 196Z"
              fill="#ffffff"
              opacity="0.34"
            />
            <path d="M254 178 C272 158 296 150 320 154" fill="none" stroke="#ffffff" strokeWidth="3" opacity="0.36" />
            <path d="M268 136 C282 106 312 98 330 118" fill="none" stroke="#f6faff" strokeWidth="2.2" opacity="0.55" />
            <path d="M350 132 C370 112 390 120 388 142" fill="none" stroke="#eef5fd" strokeWidth="1.6" opacity="0.42" />
            <g className="mira-hairpin" transform="translate(384 190) rotate(12)">
              <Star x={0} y={0} size={17} fill="#f4ead4" />
              <circle cx="0" cy="0" r="3.4" fill="#fff9e9" />
              <circle cx="0" cy="0" r="2.1" fill="#cda35f" />
            </g>
          </g>

          {/* necklace */}
          <path d="M272 404 C284 424 316 424 328 404" fill="none" stroke="url(#miraGold)" strokeWidth="1.8" opacity="0.8" />
          <circle cx="300" cy="426" r="2.8" fill="#e8c887" />
          <circle cx="300" cy="426" r="1.2" fill="#fff6dd" opacity="0.8" />

          {/* rim light from the café window */}
          <path
            d="M368 196 C390 246 394 326 384 396 C378 436 368 472 354 500"
            fill="none"
            stroke="url(#miraRim)"
            strokeWidth="4.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path d="M426 466 C442 494 452 532 456 570" fill="none" stroke="#fff2d6" strokeWidth="3" opacity="0.22" />
        </g>
      </svg>
    </div>
  );
}

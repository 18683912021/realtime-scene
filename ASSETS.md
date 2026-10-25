# 素材来源与许可

本项目运行素材包括原创代码绘制素材、VRoid Studio 的公开示例角色，以及用于原型演示的 AI 生成背景。正式公开或商用前，请逐项核对许可，尤其是背景图。

| 素材 | 文件 | 来源 | 备注 |
|---|---|---|---|
| Mira 角色（默认） | `frontend/public/vrm/AvatarSample_A.vrm` | VRoid Studio 公开示例模型 `AvatarSample_A` | 原创成年 VRoid 角色；运行时把头发贴图改为银白色、放松 T-pose，并接入姿态/眨眼/表情/口型。商用、修改和免费分发需遵守 VRoid sample model terms；出售嵌入的 VRM 数据本身不被允许 |
| Mira 角色（降级） | `frontend/src/components/Mira.tsx` | 本项目原创 SVG/CSS 分层绘制 | 原创成年角色，WebGL/VRM 加载失败时使用 |
| 三状态动图 | `frontend/public/assets/state/*.webp` | `scripts/generate_state_fx.py` 程序化绘制 | 倾听/思考/说话的透明循环 WebP，原创素材 |
| 台词配音（Mock） | `frontend/public/assets/audio/*.wav` | macOS `say -v Tingting` | 8 条预生成台词，非真人录音 |
| 台词合成（Live） | `backend/generated_tts/*.mp3` / `*.wav` | Edge 神经 TTS，失败时 macOS `say` | 按 LLM 回复实时生成，缓存不提交；根据情绪调整语速/音高 |
| 音频解锁静音 | `frontend/public/assets/audio/silence.wav` | 程序化生成 | 首次手势解锁共享 Audio 元素，避免移动端自动播放限制 |
| 雷声 | `frontend/public/assets/ambience/thunder.wav` | `scripts/generate_assets.py` 程序化合成 | 仅闪电事件使用；没有常驻雨声 |
| 咖啡馆胶片照 | `frontend/public/assets/media/photo_star.png` | 从 `cafe_urban.webp` 裁切 + 调色 | 用于照片媒体事件 |
| 图标 | `frontend/src/components/Icons.tsx` | 本项目原创 SVG | 麦克风/发送/声音/字幕/关闭/星星 |
| 字体 | 系统字体 | macOS/浏览器系统字体 | 宋体/苹方等；未打包第三方字体 |
| 咖啡馆背景 | `frontend/public/assets/backgrounds/cafe_urban.webp` | Copainter 公开图库中的 AI 生成咖啡馆示例 | **仅用于原型/演示**；商用授权未确认，正式发布前请替换 |
| VRM 渲染 | `frontend/package.json` | `three` + `@pixiv/three-vrm` | 3D 角色渲染与表情/口型驱动 |
| Live2D 运行时（可选） | `frontend/public/live2dcubismcore.min.js` | Live2D Cubism Core | 自定义 Live2D 模型适配用；受 Live2D Proprietary Software License 约束 |
| PixiJS / Live2D 插件（可选） | `frontend/package.json` | PixiJS v6 + `pixi-live2d-display` | 自定义 Live2D 模型适配用 |

## 第三方服务与许可

- Mock 模式不调用第三方模型或媒体 API。
- Live 模式调用配置的 OpenAI 兼容 LLM Provider；密钥只放服务端。
- TTS 默认使用 Edge 神经语音；macOS `say` 是离线回退。腾讯 TTS 凭据可鉴权，但资源包已耗尽。
- 3D 角色说明与许可链接见 `frontend/public/vrm/README.md`。VRoid 示例角色不是专门定制的 Mira；如果产品需要独特品牌形象，应替换为委托制作或完全自定义的成年角色。
- Live2D Core 的许可文件在 `frontend/public/live2d/LIVE2D-LICENSE.md`、`frontend/public/live2d/CORE-LICENSE.md`。
- 背景图来源页面：Copainter 咖啡馆示例图库（AI 生成）。本仓库只保存演示所需的压缩版本；未找到明确的商用授权声明，因此不作为可商用素材承诺。

## 重新生成

```bash
python3 scripts/generate_assets.py      # 配音、雷声、照片、manifest
python3 scripts/generate_state_fx.py    # 倾听/思考/说话三套循环 WebP
```

该脚本依赖：

- Python 3 + Pillow（图片与动图）
- Python `edge-tts` + `mutagen`（Live 语音与时长）
- macOS `say` 与 `afconvert`（Mock 配音与离线回退）

## 替换建议

如果要用于公开演示或商业场景：

- 用委托制作 / 明确授权的成年角色替换 VRoid 示例模型；保留 `VrmCharacter.tsx` 的状态参数接口即可。
- 用有明确商用授权的现代都市咖啡馆背景替换 `cafe_urban.webp`。
- 用有商用授权的配音替换系统 TTS。
- 在 README 中记录新的素材来源和许可证。

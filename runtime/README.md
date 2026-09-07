# Live2D Runtime

此目录用于放置用户合法取得的 Live2D Cubism Core for Web 文件。

推荐文件：

- `unsafe-eval.min.js`（Pixi 在 Electron 严格 CSP 下需要）
- `live2dcubismcore.min.js`
- `pixi.min.js`（可选；也可以使用 `npm install` 后的 Pixi）
- `pixi-live2d-display-cubism4.min.js`（可选；也可以使用 `npm install` 后的插件）

助手会优先读取本目录，再尝试 `node_modules`，最后才尝试官方 CDN。不要将受许可限制的 Core 文件提交到公开仓库或随程序公开分发。

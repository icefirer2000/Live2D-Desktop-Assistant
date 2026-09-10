# Live2D Desktop Assistant 1.0.3

Windows 透明桌面 Live2D 助手，包含模型库、行为面板、独立聊天框和控制中心。基于原有 Electron / PixiJS / pixi-live2d-display 实现扩展。

## 运行

当前交付的便携版位于项目主文件夹：双击 `Live2D-Desktop-Assistant.exe`。
可执行文件保留本地，Git 只跟踪源代码、资源、测试与文档；从 Git 克隆后请按下方命令构建。

从源码运行（Node.js 22 以上；本次使用 Node.js 24、pnpm 11）：

```powershell
npm ci
npm start
```

没有 npm 时使用：

```powershell
pnpm install --frozen-lockfile
pnpm start
```

启动后打开控制面板。首次运行模型库为空，不显示虚假角色；点击“添加随附 Miku”即可使用仓库原有模型，也可选择自己的完整模型包。旧版已保存的模型路径会尝试迁移进模型库。

## 模型与行为

- 在“模型”页选择入口文件、模型目录，或拖放文件/文件夹导入。一个目录下的多个入口会分别添加；重复导入同一入口会更新原记录。
- 支持 `.model3.json`、内容符合 Cubism 3/4 格式的 `.model` / `.model.json`，以及选择 `.moc3` 后寻找同目录唯一入口。支持 PNG、JPG、WebP 静态图片。
- 检查 moc3 文件头、纹理存在性、物理/姿态/显示信息 JSON、已声明的动作与表情、相对路径和真实文件路径。资源目录内的脚本不执行，也不提供给页面。
- 自动扫描子目录的 `.motion3.json` / `.exp3.json`。未声明动作按所在目录分组，根目录动作列入“未分组”。明确声明但损坏的资源阻止导入；额外扫描到的损坏行为显示错误并跳过。
- 模型库支持搜索、类型筛选、随机选择、清除当前选择、切换、移出、重新扫描、重新加载。移出只删除本机模型库记录，保留原模型文件。
- “行为”页只显示当前正在使用的 Live2D 模型的行为。可播放动作/表情、循环动作和停止；错误显示在状态栏。未选择模型及静态图片时没有可播放行为。
- 模型预览使用包内 `preview` / `thumbnail` / `icon` 图片；没有预览图时显示名称标识，模型本体在桌面实时显示。
- 导入资源保持原位置，外部模型目录移动后需要重新导入。随附 Miku 的路径会在便携版每次启动时重新定位。

压缩包请先解压，再导入完整目录。单独 moc3 没有纹理和入口声明，不能独立运行。Cubism 2 旧版 `.model` 会被识别并明确提示不兼容：仓库只有 Cubism 3/4 Core，没有 Cubism 2 运行时。不会使用伪造角色代替加载失败的模型。

## 桌面交互与聊天框

- 按住模型拖动桌宠窗口，拖动右下缩放柄调整模型大小。控制面板可精确设置模型位置和缩放，桌宠外围边缘可调整窗口大小。
- 点击模型打开独立透明聊天窗口，默认锚定在模型上方。窗口跟随模型移动，按显示器工作区限制位置；靠近屏幕上边缘时允许向内偏移，以保证可见。
- 聊天框顶部是拖动区域，右下角可调整大小，右上角关闭。再次打开恢复保存的尺寸及相对模型偏移。
- 问候页显示当前模型名称，以及额度/使用情况、任务活动、权限请求与设置入口。它是本地状态助手，不冒充 ChatGPT 的聊天客户端。
- 可调宽高、位置偏移、圆角、背景不透明度、颜色、阴影、字号、淡入动画与时长。内容在较小尺寸下内部滚动，保持按钮可读。
- “锁定布局”同时禁止桌宠窗口、模型及聊天框移动与缩放；点击、关闭和打开仍可用。解锁后可继续调整。
- 使用 Electron 工作区 DIP 坐标与页面缩放；跨屏移动、显示器移除及 DPI 变化后重新适配，避免重复应用系统 DPI。

## 选项与配置

包括开机自启动、始终置顶、窗口不透明度、桌宠窗口尺寸、模型缩放与位置、聊天框显示方式、浅蓝灰/深色主题、布局锁定、数据来源和恢复默认设置。修改后自动保存。恢复默认设置保留模型库及当前模型。

配置位于 `%APPDATA%\live2d-desktop-assistant\assistant-config.json`，模型库位于同目录 `model-library.json`。配置 `schemaVersion: 3`，支持未版本化旧配置迁移、字段校验和临时文件原子替换。迁移前保留备份，损坏 JSON 留存 `.corrupt-时间戳.bak`；较新未知配置版本拒绝覆盖。配置不会写入仓库。

便携版自启动记录原始便携 EXE 的位置；启用后若移动 EXE，应重新关闭并开启自启动。控制面板关闭后桌宠继续运行，使用“退出助手”结束程序。

## 数据来源与隐私

保留原有本地演示数据（短期已用 54%、周期已用 65%、积分 0、重置 1），界面标明演示来源。这些数值不是实际账户额度。

桥接模式仅请求用户明确配置的本机 HTTP(S) JSON 地址，例如 `http://127.0.0.1:8765/status.json`。字段示例见 [data/bridge-status.example.json](data/bridge-status.example.json)。请求在主进程完成，不携带浏览器 Cookie，限制本机地址、禁止重定向，设有超时和响应大小上限。失败保留上一次快照并显示错误。

不读取 ChatGPT Desktop Cookie、私有数据库、凭据或内部页面。不在仓库保存 Key / Cookie。renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；preload 只暴露白名单功能，主进程校验 IPC 来源和模型资源权限。Live2D 运行时全部本地加载。

## 检查与构建

```powershell
npm run check
npm test
npm run pack:portable
```

无 npm 时等价执行：

```powershell
pnpm run check
pnpm test
pnpm run pack:portable
```

构建便携版输出：`dist\1.0.3\Live2D Desktop Assistant 1.0.3.exe`。本次验证后的文件已移动并命名为根目录 `Live2D-Desktop-Assistant.exe`。
目录版输出：`dist\1.0.3\win-unpacked\Live2D Desktop Assistant.exe`（整个文件夹一起使用）。

`npm run pack` / `pnpm run pack` 只构建目录版。旧版本 EXE 及旧浏览器设置启动器已清理。旧设置页源码归档到 `legacy/browser-settings`，旧同步脚本归档到 `legacy/sync-to-d.ps1`；实际控制面板使用 `src/settings.html`，应从助手 EXE 打开。`dist` 保留验证记录及部分构建辅助文件，不纳入 Git。

pnpm 构建声明只允许 Electron 所需安装脚本，跳过便携构建不使用的 electron-winstaller 安装脚本，配置说明见 [pnpm 官方构建设置](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md#allowbuilds)。

### 可重复运行验证

```powershell
pnpm run verify
# 直接启动并验证便携 EXE
node scripts/run-verify.cjs 'Live2D-Desktop-Assistant.exe'
```

验证使用单独临时用户配置，包含真实模型加载、动作参数变化、循环、表情、停止、气泡开关、尺寸恢复、锁定和页面溢出检查。结果和截图位于 `dist/verification`。设置 `LDA_TEST_PROFILE` 可在同一测试配置上验证重启恢复。测试入口只有同时传入 `--verify` 和隔离配置环境变量时启用，不读取正常用户配置。

详细验收结果见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

## 模块与扩展

| 文件 | 职责 |
| --- | --- |
| `main.js` | 窗口、原生拖动、IPC 来源验证、屏幕事件、本机桥接 |
| `preload.js` | 白名单方法与可取消的事件订阅 |
| `src/model-manager.js` | 模型库、扫描校验、资源白名单协议 |
| `src/settings-store.js` | 版本化配置、迁移、校验、原子保存 |
| `src/layout-manager.js` | 工作区边界与聊天框锚定计算 |
| `src/responsive-scale.js` | DIP 工作区比例计算 |
| `src/action-catalog.js` | 主进程和面板共享的行为目录与身份验证 |
| `src/motion-manager.js` | renderer 动作处理注册器、播放、循环、停止 |
| `src/control-panel.js` | 导航和设置字段配置 |
| `src/settings.js` / `.html` / `.css` | 控制面板视图和交互 |
| `src/renderer.js` / `index.html` / `styles.css` | 复用桌宠与聊天内容，按窗口角色运行 |
| `src/data-provider.js` | 原有演示与桥接数据适配 |
| `tests` / `scripts` | 核心测试、语法与依赖检查、Electron 验证 |

新增设置和菜单优先添加到 `control-panel.js`。新增动作类型在 `action-catalog.js` 注册列表/身份字段，在 `motion-manager.js` 注册执行器；文件格式扫描放入模型模块，避免扩散到窗口管理代码。

## 许可与限制

模型与 Cubism Core 沿用仓库资源，遵循原作者和 Live2D 的许可，不意味着可自由公开再分发。此便携版未配置代码签名证书，使用默认 Electron 图标。真实多显示器移动、Windows 登录后自启动需要在对应硬件/登录会话验收；自动化测试不会替用户修改实际开机启动项。

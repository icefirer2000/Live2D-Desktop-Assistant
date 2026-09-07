# Live2D Desktop Assistant 1.0.2

一个运行在 Windows 桌面上的 Live2D 桌宠助手。当前 1.0.2 版本以 Miku 模型为默认模型，提供模型显示、桌面交互、对话气泡和本地数据展示能力。

## 当前版本

- 版本：`1.0.2`
- Git 标签：开发中，目标为 `v1.0.2`
- 平台：Windows x64
- 技术栈：Electron、PixiJS、pixi-live2d-display、Live2D Cubism Core
- 默认模型：`miku/miku.model3.json`
- 便携版入口：[Live2D-Desktop-Assistant.exe](./Live2D-Desktop-Assistant.exe)

## 功能

- 启动后在桌面显示 Live2D 模型，窗口支持透明显示。
- 默认加载项目内的 Miku 模型，也可以在设置中导入其他 `.model3.json` 模型及其资源目录。
- 支持 PNG、WebP、JPG 等自定义图片作为静态模型。
- 模型可在窗口内拖动、缩放、调整位置，并支持动作和表情选择。
- 外围桌宠窗口可拖动、调整大小；模型默认保持在窗口中央并随窗口适配。
- 对话气泡可独立拖动、调整大小，位置和大小会保存到下次启动。
- 对话面板提供问候、使用情况、当前聊天、权限请求、模型设置等入口。
- 1.0.2 欢迎页采用“问候区 6：功能区 4”布局，动作选择保持单行滚动，减少功能入口拥挤；仅在关闭后重新打开气泡时刷新问候内容。
- 锁定布局后，聊天气泡会使用已保存的自身尺寸计算边界，关闭并重新打开不会因隐藏态尺寸为零而发生位置偏移。
- 独立设置窗口新增“聊天框设置”，可开启淡入并调整淡入时间，选项会保存到本机。
- 独立设置窗口中的透明度和始终置顶会即时应用并持久化保存。
- 支持布局锁定：锁定后模型、桌宠窗口和对话框的位置及大小不可修改，但模型点击、对话框打开和关闭仍可使用。
- 所有用户界面设置会保存，重新启动后恢复。

## 数据来源与隐私边界

当前版本不会读取 ChatGPT Desktop 的私有页面、Cookie、登录凭据或内部数据库，也不会直接读取 ChatGPT Plus/Codex 的真实账户余额。默认展示的是演示数据，用于验证界面和交互：短期使用量 54%、周期使用量 65%、积分 0、可用重置次数 1。

项目预留了本地桥接数据接口。设置为桥接模式后，程序会从配置的 JSON 地址读取以下数据：`usage`、`activities`、`permissions`。示例文件位于 [data/bridge-status.example.json](./data/bridge-status.example.json)，请求使用不缓存模式。要接入真实数据，需要由用户自行提供合法、稳定且有权限的本地服务；请勿把 API Key、Cookie 或其他凭据写入仓库。

## 直接运行

双击根目录的 `Live2D-Desktop-Assistant.exe`，或在 PowerShell 中执行：

~~~powershell
.\Live2D-Desktop-Assistant.exe
~~~

如果需要单独打开设置面板，可运行根目录的 `Live2D-Desktop-Assistant-settings-launcher.exe`。

## 从源码运行

需要安装 Node.js 和 npm：

~~~powershell
npm install
npm start
~~~

开发模式可使用：

~~~powershell
npm run dev
~~~

## 构建便携版

~~~powershell
npm run pack:portable
~~~

构建产物会写入 `dist/`，该目录已加入 `.gitignore`。如需目录版构建：

~~~powershell
npm run pack
~~~

## 项目结构

~~~text
main.js                         Electron 主进程和窗口管理
preload.js                      渲染进程桥接
src/renderer.js                 桌宠渲染、拖动、缩放和交互
src/settings.js                 设置面板逻辑
src/data-provider.js            演示数据与本地桥接数据
src/model-loader.js             Live2D 模型和图片导入
settings.html / settings.css    独立设置窗口
data/                           示例数据和运行配置模板
miku/                           默认 Miku Live2D 模型资源
runtime/                        Live2D Cubism Core 运行时
~~~

用户配置保存在 `%APPDATA%\\live2d-desktop-assistant\\assistant-config.json`，不会写入项目目录。模型资源应保持 `.model3.json`、纹理、动作、表情和物理文件之间的相对路径关系；删除或改名资源可能导致模型无法加载。

## Git 版本信息

本仓库的 1.0.0 版本已通过本地 Git 提交并标记为 `v1.0.0`。1.0.2 正在进行 UI 与显示设置迭代。依赖目录、构建缓存和 `dist/` 不纳入版本控制；根目录便携版 EXE 与项目源码一并保留，便于直接运行当前版本。

## 许可与模型资源

本项目代码仅用于本地开发和个人使用。Miku 模型及其纹理、动作、表情等资源请遵循资源作者和原始发布渠道的许可要求，不要未经许可重新分发。

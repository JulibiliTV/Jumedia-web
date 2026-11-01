# Jumedia Web

Jumedia 是一个自托管的在线视频与直播平台。本仓库是它的网页端，包含三部分：

- **前台**：首页推荐、分区与频道、番剧 / 影视、排行榜、搜索、视频与番剧播放、直播、个人空间、动态。
- **个人中心与创作中心**：历史、收藏、稍后再看、追番、关注、账号设置；投稿、合集、数据、直播设置、媒体数据源。
- **管理后台**：仪表盘、用户、稿件审核、番剧、直播、评论与弹幕、分区、轮播、数据源、站点与服务器设置、操作日志。

前端基于 React 18、React Router、Vite 和 TypeScript，支持浅色与深色主题。

网页端内置一套在浏览器中运行的 **Mock 服务**，不需要后端即可完整体验；连接 [Jumedia Server](../Jumedia-server) 后即为正式部署。

## 快速开始

需要 Node.js 18 或更新版本。

```sh
git clone <repo-url> Jumedia-web
cd Jumedia-web
npm install
npm run dev
```

打开 <http://localhost:8790>。默认启用 Mock 服务，数据保存在浏览器的 localStorage，上传的视频保存在 IndexedDB；初始只有基础分区、设置和管理员账号，没有演示内容。在管理后台「站点设置」中可导入演示数据包或重置为初始状态。重置删除所有内容、保留全部管理员账号，IndexedDB 上传文件不删除。

Mock 引导账号（仅浏览器 Mock 内置）：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `jumedia` | `admin123` | 管理员 |

## 连接后端

先启动 Jumedia Server（默认 `:8080`），然后：

```sh
API_PROXY=http://127.0.0.1:8080 VITE_MOCK=0 npm run dev
```

开发服务器会把接口、上传、媒体和直播请求代理到后端，浏览器以同源方式访问，Cookie 正常生效。

### 构建与部署

```sh
VITE_MOCK=0 npm run build
```

产物在 `dist/`。最简单的部署方式是由后端直接提供：启动 Jumedia Server 时设置 `JUMEDIA_WEB_DIR=../Jumedia-web/dist`。也可以用任意静态服务器托管 `dist/`，此时需要把接口路径反向代理到后端，并把未命中的路径回退到 `index.html`。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_MOCK` | 启用 | 设为 `0` 时关闭浏览器 Mock，请求真实后端 |
| `API_PROXY` | 空 | 开发服务器的后端代理地址，例如 `http://127.0.0.1:8080` |
| `VITE_API_BASE` | 同源 | 所有接口的基础地址 |
| `VITE_API_HOST` / `VITE_APP_HOST` / `VITE_PASSPORT_HOST` / `VITE_LIVE_HOST` | `VITE_API_BASE` | 分别指定主站、客户端、登录、直播接口的地址，用于分布式部署 |
| `VITE_LIBMEDIA_WASM` | jsDelivr | libmedia 解码器 WebAssembly 文件的地址，可指向自托管副本 |

`VITE_*` 变量在构建时写入产物，修改后需要重新构建。

## 播放能力

- **点播**：MP4（H.264）使用浏览器原生播放；MKV 等其他容器通过 [libmedia](https://github.com/zhaohappy/libmedia) 在页面内解封装和解码（优先 WebCodecs 硬件解码，否则 WebAssembly 软解）。
- **直播**：HLS 使用 hls.js 播放，也支持 MP4 直播流。
- **弹幕**：protobuf 分段弹幕与直播聊天；支持发送、屏蔽词和样式设置。

## 演示媒体

演示内容只通过 `jumedia-demo` v1 JSON 数据包导入，不随应用初始化写入。使用自己的 Emby 生成数据包：

```sh
EMBY_URL=https://emby.example.test EMBY_USER=demo EMBY_PASSWORD='<密码>' node scripts/import-emby.mjs ./jumedia-demo.json
```

`EMBY_URL` 必填，`EMBY_USER` / `EMBY_PASSWORD` 从环境变量读取。第一个命令行参数为输出路径，默认为 `./jumedia-demo.json`，`jumedia-demo*.json` 已被 Git 忽略。默认不将密码写入文件；需要随包携带密码时设置 `DEMO_INCLUDE_PASSWORD=1`。脚本只收录 MP4 / M4V / MOV、H.264 + AAC/MP3 的可直播放条目，图片引用 Emby 地址，不复制媒体或保存访问令牌。

登录后台，在「站点设置」选择「导入演示数据包」。仅允许基础数据和管理员账号的初始状态导入，已有内容时需先重置。导入保留站点设置和真实管理员；生成的普通演示账号统一使用 `demo123`，用户名带 `demo_<mid>_` 前缀，可在用户管理页查看。

Mock 的 Emby 地址、用户名和密码随包保存在浏览器 DB，包中未含密码时按空密码连接。真实服务端使用数据源密钥加密密码，并代理媒体请求；Mock 直接连接 Emby，需要源站允许跨域。用户头像仍使用 `public/mock/avatars/` 下的静态图片。

## 目录结构

```text
src/api/client.ts      请求层：参数排序、表单编码、请求签名、CSRF
src/api/juli.ts        与 JulibiliTV 的 Jumedia 数据源一致的接口
src/api/jumedia.ts     Jumedia 扩展接口：注册、上传、创作中心、管理后台等
src/api/normalize.ts   把接口数据转换为页面使用的视频、番剧、直播、动态、评论模型
src/api/protobuf.ts    弹幕的 protobuf 编解码
src/components/        布局、卡片、播放器等通用组件
src/pages/             前台页面；account/ 个人中心；creator/ 创作中心；admin/ 管理后台
src/mock/              浏览器内 Mock 服务（接口契约）
src/styles/            全局样式与设计变量
public/                品牌资源与演示资源
scripts/               演示媒体导入脚本
```

## 接口契约

`src/mock/` 是前后端共用的接口契约：路径、参数、错误码、提示文案和 JSON 结构都以它为准，Jumedia Server 按它实现。修改或新增接口时，先在 Mock 中实现，再同步到后端。

接口与 JulibiliTV 的 Jumedia 数据源保持一致，电视客户端可以直接使用 Jumedia 作为数据源，因此：

- JulibiliTV 已使用的接口只能新增字段，不能修改或删除已有字段。
- 新增接口优先沿用相同风格的路径；无法对应的功能使用 `/x/jumedia/*`、`/x/admin/*` 等 Jumedia 专用路径。

响应统一为 `{ code, message, ttl, data }`（番剧类接口为 `result`）。登录态保存在 Cookie `SESSDATA`、`bili_jct`、`DedeUserID` 中，写操作携带 `csrf` 参数；这些名称沿用 Jumedia 数据源的协议。

## 开发

```sh
npm run typecheck   # 类型检查
npm run build       # 类型检查并构建
npm run preview     # 预览构建产物
```

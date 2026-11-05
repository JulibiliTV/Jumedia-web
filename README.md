# Jumedia Web

Jumedia 是一个聚合 Emby、Jellyfin、飞牛影视等媒体源和弹弹 Play 弹幕源的媒体平台，既可用于多人之间的媒体分享，也可用于个人多个媒体库的统一聚合。

本仓库是 Jumedia 的网页端，包含三部分：

- **前台**：首页推荐、分区与频道、番剧 / 影视、排行榜、搜索、视频与番剧播放、直播、个人空间、动态。
- **个人中心与创作中心**：历史、收藏、稍后再看、追番、关注、黑名单、账号设置；投稿、合集、数据、直播设置、媒体数据源。
- **管理后台**：仪表盘、用户、稿件审核、番剧、直播、评论与弹幕、分区、轮播、数据源、站点与服务器设置、操作日志。

前端基于 React 18、React Router、Vite 和 TypeScript，支持浅色与深色主题。

后台「数据源」支持编辑系统和用户添加的 Emby，并在列表显示代理状态；用户数据源编辑后保留原归属，已保存的密码不会回填，留空时保持原密码。后台「用户管理 → 修改密码」可直接设置 Jumedia 用户的新密码，无需原密码；保存后该用户已有登录会话失效，需要重新登录。

黑名单管理位于本人个人空间的「黑名单」Tab，在「关注」旁边，地址为 `/space/自己的UID?tab=blacklist`，仅本人可见。支持分页查看和解除拉黑；解除拉黑不会自动恢复关注。旧地址 `/account/blacklist` 会跳转到本人空间的黑名单 Tab。

发表评论使用统一的 `/x/v2/reply/add` 返回值，成功时显示 `success_toast`，失败保留输入并显示服务端提示。后台「站点设置 → 评论」可开关评论和楼中楼回复，设置按账号的发言间隔及同一位置的重复评论拦截时间（0–86400 秒，默认 0 表示不限制）。敏感词直接拒绝发表；被 UP 主拉黑的账号不能在其稿件下发表评论。浏览器 Mock 使用相同返回字段、错误码与检查规则。当前不启用验证码，成功响应的 `need_captcha` 为 `false`。

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

Docker 部署使用镜像 `ghcr.io/julibilitv/jumedia-web`（推送到 `main` 后由 GitHub Actions 构建）。它只包含构建好的网页文件：容器运行时把文件复制到 `/web` 卷后退出，由挂载同一个卷的 Jumedia Server 提供，编排见 Jumedia-server 的 `deploy/compose.yaml`。只发布网页端时不需要重启后端：

```sh
docker compose pull web && docker compose up web
```

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

Mock 的 Emby 地址、用户名和密码随包保存在浏览器 DB，包中未含密码时按空密码连接。真实服务端使用数据源密钥加密密码。数据源表单默认勾选「通过 Jumedia 代理播放」，取消后普通视频和番剧直接使用包含 Emby 访问令牌的播放链接，设备需要能访问源地址，网页播放需要满足 HTTPS 和跨域要求。已有数据源默认保持代理。Mock 保存同一开关，但纯浏览器模式始终直连 Emby，需要源站允许跨域；代理播放须连接真实 Jumedia 服务端。图片代理和直播转播不受该开关影响。用户头像仍使用 `public/mock/avatars/` 下的静态图片。

管理员可在「站点设置 → 弹弹play 弹幕」填写接口地址，开启 Emby 弹幕同步。支持自部署的兼容服务，地址可包含 token 路径或以 `/api/v2` 结尾；无需签名的服务可将 App ID 和 App Secret 同时留空，需要签名时再同时填写。已保存的 App Secret 留空保持不变；切换到无需签名的服务时，清空 App ID 并勾选清除已保存的 App Secret。播放 Emby 内容时先显示本地弹幕，后台自动获取外部弹幕；播放器在获取完成后刷新合并，无需刷新页面或重播视频，换集后不会接受旧分集的响应。重新同步数据源也可预取弹幕。审核页展示同步状态、缓存数量和弹幕列表，支持分集播放与点击时间预览。浏览器 Mock 使用本地示例弹幕演示相同流程，不保存输入的 App Secret，也不请求外部弹幕服务；真实环境需使用 `VITE_MOCK=0` 连接 Jumedia-server。

网页每次播放或续播都会向服务端检查当前播放位置的弹幕分段；已有本地弹幕不会阻止外部弹幕检查。服务端决定是否使用缓存或请求弹弹 API，只缓存正常结果，失败不覆盖缓存。超过 30 分钟后的重试如果失败，继续使用之前的正常结果（包括正常空结果）。尝试时间单独记录，同一媒体在 30 分钟内已尝试过时不会重复请求弹弹 API。已有正常外部弹幕直接使用缓存。

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

## 许可证

Copyright 2026 Jumedia contributors.

除另有声明的第三方组件与资源外，本项目采用 [Apache License 2.0](LICENSE) 开源。第三方代码、依赖与资源保留各自的许可证和版权声明。

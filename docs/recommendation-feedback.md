# 首页推荐反馈与 Mock

网页 `feedDislike` 使用 `POST /x/web-interface/feedback/dislike`，`cancelFeedDislike` 使用 `POST /x/web-interface/feedback/dislike/cancel`，均由统一 API 客户端读取当前会话 CSRF。参数为 `goto: 'av'`、正整数视频 `id`、`reason_id: 1 | 4`，可选 `mid` 和 `track_id`。

原因 `1` 保存对此视频的反馈；原因 `4` 保存对稿件作者的反馈。`mid` 是作者 ID，缺失或 `0` 时从视频读取，非零值必须匹配。反馈用户从会话读取，不采用请求中的 `mid`。两类反馈分别撤销，重复提交和重复撤销均幂等。撤销后内容重新进入推荐候选池，不保证出现在当前页。

两个接口均要求 POST 和当前会话的 CSRF，`csrf` 有值时优先，否则读取 `biliCSRF`。未登录返回 `-101`，封禁账号 `-403`，CSRF 无效 `-111`，方法不支持 `-405`，参数或作者不匹配 `-400`，稿件不存在 `-404`，内部错误 `-500`。成功返回标准信封且 `data` 为 `null`。稿件存在性要求同样适用于撤销。

Mock 将偏好保存到浏览器数据库的 `recommendationFeedback`，记录键为当前用户、原因和目标 ID，刷新后保留。旧数据缺少该字段时按空数组处理，不重置数据。它与视频踩、关注、黑名单及视频统计独立。

`/x/web-interface/wbi/index/top/feed/rcmd` 和 `/x/v2/feed/index` 都在排序、分页前过滤当前用户的视频及作者反馈；无候选时返回空数组。其他用户、访客以及热门、排行、搜索、关注和详情不受影响。Web 卡片的 `dislike_switch` 对登录用户为 `true`，访客为 `false`，`pubdate` 及原有分页规则不变。旧卡片仅提供原因 `1` 和 `4`。

旧 `/x/feed/dislike` 共用相同偏好，匹配会话的 `access_key` 支持 GET/POST；Cookie 调用要求 POST 与 CSRF，其反馈可通过新撤销接口撤销。`goto=ad` 保留校验后的确认行为，不创建视频或作者偏好。其他追踪、签名和展示参数不参与偏好身份识别。

运行 `node scripts/check-recommendation-feedback.mjs` 验证提交、撤销、叠加反馈、用户隔离、分页过滤、空列表、持久化和旧入口。完整服务端契约见服务端仓库的 `docs/recommendation-feedback.md`。

[English](README.md) | [简体中文](README.zh-CN.md)

# ChatGPTExporter Community

这是从 [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter) 衍生的**非官方社区兼容分支**，适配当前 ChatGPT 网页版的 Projects 分页和对话历史分页接口。本项目与 OpenAI 没有关联，也未获得 OpenAI 的认可。

ChatGPTExporter Community 是注重隐私的本地 Chromium 扩展，可用于导出 ChatGPT 对话和备份聊天记录。它先清点你明确选择的工作区中的普通对话、已归档对话、Projects 和分享对话，再抓取可访问的对话内容、账户资料、文件与附件。可访问的个人工作区和 ChatGPT Business/Team 工作区分别保存为本地归档。

身份验证留在正常登录的 `chatgpt.com` 页面内。扩展不会要求你粘贴令牌或 Cookie，没有后端或遥测服务，只向你选择的目录写入数据。

**私有 API 提醒：**本工具使用未经公开文档说明的 ChatGPT 网页接口。这些接口会随时间变化，也可能再次在没有通知的情况下改变。依赖备份或迁移结果之前，请检查验证报告和原始证据。

## 为什么有这个分支

上游 `0.1.6` 遇到了当前 ChatGPT 网页行为变化：实际的 Project 分页游标可能更长，并含有 Base64 字符；对话历史改用复数形式的分页接口；长对话需要向前翻取更早的消息；较早的消息页也可能合法地省略对话身份字段。本分支适配这些响应形状，同时保留首页严格的身份核对和遇到异常即停止的验证策略，而非简单地取消身份验证。

相关上游讨论包括 [PR #2](https://github.com/siraht/ChatGPTExporter/pull/2)、[Issue #4](https://github.com/siraht/ChatGPTExporter/issues/4) 和 [Issue #5](https://github.com/siraht/ChatGPTExporter/issues/5)。本分支已在一个包含数百条对话和多个 Projects 的真实 ChatGPT Business 工作区完成验证：对话抓取及本地验证均成功。这里不包含该工作区的任何私有标识或内容。

## 兼容性改动

- Project 分页接受有安全长度上限的较长游标，包括所需的 Base64 字符和冒号。空游标正常终止；安全的非负整数游标转为字符串；请求参数经过 URL 编码。
- 对话抓取从 `/backend-api/conversations/{id}?include_has_versions=true&num_turns=100` 开始，再通过 `/backend-api/conversations/{id}/messages?before=...` 向前翻页，直到服务端声明没有更早的页面。当前接口返回 404 时，仍可尝试旧的完整对话图接口。
- 向前翻页时检查每页是否取得进展，拒绝缺失或重复的游标，处理稳定的边界重复消息，并执行页数和字节数上限。每个服务端原始页面都会保留为证据。
- 首页必须至少包含一个可识别的对话身份字段，且所有出现的字段都必须匹配请求的对话。较早的消息页可以完全没有身份字段；只要出现字段，每个字段都必须匹配。冲突或错误身份会使抓取停止，诊断信息不显示原始 ID 或正文。
- 现有的断点续传、归档哈希、清单核对和独立验证继续适用。抓取不完整时会明确报告，不能默默视为完成。

分页接口提供消息页，而不是完整分支图。因此派生的映射表示这些页面返回的有序消息；原始页面仍保存在归档中以供检查。参见 [CHANGELOG.md](CHANGELOG.md) 了解社区版本记录。

## 保存哪些内容

- 正常完成清点的普通、已归档、Project 和分享对话。
- 每个明确选定且可访问的个人或 Business/Team 工作区的独立历史，避免不同工作区混在一起。
- 旧接口提供完整对话图时，保存其中的分支和非当前节点；分页接口则保存有序消息和所有原始页面。
- 引用、浏览／工具／代码记录、Canvas、已完成的深度研究内容、未知内容块及服务端原始扩展字段。
- ChatGPT 允许访问的上传文件、生成图片、音视频、内联二进制内容、研究文件和 Project 文件。
- 可访问的 ChatGPT 记忆、自定义指令、设置、测试版功能设置，以及经过处理的工作区／会话元数据。
- 后续远程清单中消失的既有本地对话：标记为远端缺失，而不是删除本地副本。

## 从源代码安装与构建

需要 Node.js 20 或更新版本，以及支持 Manifest V3 和 File System Access API 的 Chromium 浏览器。

```sh
git clone https://github.com/Trojon99/ChatGPTExporter-Community.git
cd ChatGPTExporter-Community
npm ci
npm run check
npm run test:e2e
npm run build
```

打开 `chrome://extensions`，启用开发者模式，选择 **加载已解压的扩展程序**，然后选中 `dist/extension`。点击扩展图标打开控制面板。

## 导出与验证流程

1. 在同一浏览器配置文件中打开并正常登录 `https://chatgpt.com/`。
2. 在扩展控制面板找到该标签页，明确选择要归档的工作区。
3. 运行预检，再选择归档父目录。每个工作区使用独立的 `ChatGPTExport-<fingerprint>` 子目录。
4. 选择清点范围，生成清单，查看汇总数量和分页终止证据，然后确认清单。
5. 开始或继续抓取。可以在下次请求前暂停、恢复、安全取消，或重跑以重试未完成的记录。
6. 检查最终状态：`complete` 表示对话和已请求的资源通过独立审计；`conversations complete / assets partial` 表示文件存在明确的例外；`incomplete` 表示归档未被接受。
7. 查看工作区归档中的 `reports/validation.md`。移动或检查本地归档后，可用 **Revalidate only** 在不联系 ChatGPT 的情况下重新核验文件。

不要同时针对同一账户运行多个导出器。默认请求间隔为 250 毫秒、并发数为 1、批量大小为 10，这些设置用于保守地控制请求。

## 安全模型与已知限制

- 扩展只申请 `https://chatgpt.com/*` 主机权限。带身份验证的请求在现有 ChatGPT 页面执行；令牌和签名资源 URL 留在该页面环境。下载前会检查资源域名和跳转目标。没有后端、遥测、分析或远程归档上传。
- 本地归档含有敏感的对话、记忆、标题、文件名和附件。请保护所选目录；未经检查，不要将原始归档或验证报告附在公开 Issue 中。
- 本工具只能抓取已登录工作区通过当前网页接口可访问的内容，无法重建临时、已删除或不可访问的记录。某些旧资源引用或已失效文件可能返回 HTTP 404，即使对话内容已经完整；验证报告会将资源范围标为部分完成。
- 当前分页响应提供有序消息，而非完整分支图。派生映射是线性表示，所有服务端页面都会保留为原始证据。接口变化、页面格式错误、游标重复或触及页数／字节数上限时，会明确报告未完成，而不是静默截断。

## 归档与迁移接口

`source/` 下的原始清单、对话详情及批量抓取修订会追加保存；分页详情还会在 `source_pages` 中保留每个服务端页面。规范化 JSON、Markdown、索引和报告是可重建的派生文件。完成标记最后写入，记录所有必要对话文件的哈希。

经过审计的目录可以交给独立的 Agent Session Archive 适配器使用，无需合成一个巨大的 `conversations.json`：

```sh
asm web-import ./ChatGPTExport-WORKSPACE-FINGERPRINT \
  --provider chatgpt-web --account-label personal --dry-run --json
```

这个外部导入器可用于后续的 ChatGPT 历史迁移；它不是浏览器扩展的一部分。详细运行说明见英文的 [架构](docs/ARCHITECTURE.md)、[网页数据契约](docs/WEB_CONTRACT.md)、[隐私模型](docs/PRIVACY.md) 和 [故障排查](docs/TROUBLESHOOTING.md)。

## 开发

```sh
npm test
npm run typecheck
npm run privacy:check
npm run test:e2e
npm run package
```

项目没有运行时 npm 依赖；Playwright、Vitest、TypeScript 和 esbuild 仅用于开发。贡献代码必须使用合成测试数据，并通过暂存内容隐私扫描。参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证与来源

本社区分支保留 [siraht/ChatGPTExporter](https://github.com/siraht/ChatGPTExporter) 的原始 [MIT License](LICENSE) 和版权声明。原项目中的少量存储、控制面板和构建基础代码改编自 GrokExporter；网页接口及内容形状研究参考了固定版本的 MIT 上游项目。具体版本、采用与未采用的设计见 [UPSTREAM_RESEARCH.md](docs/UPSTREAM_RESEARCH.md)。本项目不是上游维护的正式后续版本，也不是 OpenAI 产品。

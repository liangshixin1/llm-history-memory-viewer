# Claude 对话展示器

一个本地运行的 Vue + Flask Webapp，用来导入 Claude 导出的 zip 包、解析会话结构，并以阅读器界面展示用户与 Claude 的对话。

Claude 导出包支持以下结构：

```text
Claude项目/
  conversations.json
  memories.json
  users.json
  projects/
    <project_uuid>.json
```

当前前端支持识别 Claude 回复中的 Mermaid fenced code block，并渲染为图表：

````markdown
```mermaid
flowchart LR
A[导入 JSON] --> B[解析]
B --> C[展示]
```
````

同时支持：

- Markdown 表格、列表、标题、粗体、引用、行内代码等常见格式
- 代码块一键复制
- 导入 `users.json` 后用 `full_name` 替换对话中的“我”，并显示本地头像
- 导入 `memories.json` 后，在“大模型人格迁移”页装配 Claude memories 与指定日期范围的 conversation overview
- 导入 zip 时自动解析 `projects/*.json`，并在“项目”页展示项目文档
- 生成并一键复制迁移到其他大模型平台的系统提示词
- 前端隐藏 `tool_use`、`tool_result`、`server_tool_use`、`web_search_tool_result`、`token_budget` 类型内容块

## JSON 结构

Claude 导出的会话对象核心字段如下：

- `uuid`: 会话 ID
- `name`: 会话标题
- `summary`: Claude 生成的会话摘要
- `created_at` / `updated_at`: 会话创建与更新时间
- `account.uuid`: 账号 ID
- `chat_messages`: 消息数组

每条 `chat_messages` 消息通常包含：

- `uuid`: 消息 ID
- `sender`: `human` 或 `assistant`
- `text`: 聚合后的消息文本
- `content`: 细分内容块数组
- `created_at` / `updated_at`: 消息时间
- `attachments` / `files`: 附件信息
- `parent_message_uuid`: 父消息 ID

`content` 里常见块类型：

- `text`: 正文内容，字段为 `text`
- `thinking`: Claude 思考内容，字段为 `thinking`
- `tool_use` / `tool_result`: 工具调用与结果
- `server_tool_use`、`web_search_tool_result`、`artifacts` 等扩展块

## 运行

```bash
python3 -m pip install -r requirements.txt
npm install
python3 backend/app.py
```

然后打开：

```text
http://127.0.0.1:5000
```

优先直接上传 Claude 原始导出的 `.zip` 包；单独的 `.json` 导入入口仅作为补充调试使用。

## 测试

```bash
python3 -m unittest
```

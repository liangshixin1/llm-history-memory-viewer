# Claude 对话展示器

这是一个可以在本地打开的网页应用，用来阅读和整理 Claude 导出的聊天记录。

普通使用者不需要安装 Python、Node.js、npm，也不需要启动服务器。只要打开发布好的 HTML 文件，把 Claude 导出的 zip 拖进去，就能在浏览器里查看对话。

这个应用的特色功能是“大模型人格迁移”：它会把 Claude 导出包里的长期记忆、会话摘要、项目资料和时间范围内的互动记录整理成一份可复制的迁移提示词。你可以把这份提示词交给其他大模型，让新模型更快理解你的长期背景、表达偏好、正在推进的项目和协作习惯。

## 可以做什么

- 阅读 Claude 导出的所有会话，按标题、摘要和正文搜索。
- 自动识别 Claude 导出包里的 `conversations.json`、`users.json`、`memories.json` 和 `projects/*.json`。
- 用更舒服的阅读器界面展示用户和 Claude 的对话。
- 展示 Markdown 表格、列表、标题、引用、代码块等常见格式。
- 自动把 Mermaid 代码块渲染成图表。
- 渲染对话中的 LaTeX 公式，支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- 按日期升序或降序排列对话，并用热力图查看每天的对话密度。
- 一键复制代码块、项目资料、长期记忆和迁移提示词。
- 查看 Claude Memories 和 Claude Projects。
- 生成“大模型人格迁移”提示词，方便把长期记忆整理后迁移到其他大模型平台。

所有解析都在浏览器本地完成，文件不会上传到服务器。

## 人格迁移怎么用

导入 Claude 原始 zip 后，切换到“人格迁移”页面。你可以选择最近 3 个月、6 个月、1 年、全部会话，或自定义日期范围。网页会把以下内容装配成一份系统提示词：

- Claude Memories 中保存的长期记忆
- 所选日期范围内的 conversation overview
- Claude Projects 中的项目说明和项目文档
- 用户账号名称等必要识别信息

生成的提示词不会自动发送到任何平台。你可以先在页面里预览，再点击复制，把它粘贴到目标大模型的系统提示词、长期记忆或初始化对话里。

## 普通用户怎么用

1. 下载 `dist` 文件夹下的 `Claude对话展示器.html`，然后打开它。
2. 从 Claude 导出你的数据包，通常是一个 `.zip` 文件。
3. 把这个 `.zip` 文件拖进网页左侧的导入区域，或点击导入区域选择文件。
4. 导入完成后，在左侧选择对话，在右侧阅读内容。
5. 需要整理长期记忆或迁移到其他大模型时，切换到“记忆”“项目”或“人格迁移”页面。

如果你收到的是发布版本，只需要保留这一个 HTML 文件即可。

## 重要说明

- 可以直接分发给普通用户的是 `dist/Claude对话展示器.html`。
- `frontend/index.html` 是开发源码入口，它还依赖旁边的 CSS、JS 和 vendor 文件，不能单独拿出来发给普通用户。
- 生成发布版后，普通用户不需要运行 `npm install` 或 `npm run build:single`。

## 开发者指南

### 项目形态

这是一个纯前端 Webapp。源码保留为多个文件，方便维护；发布时构建成单个 HTML 文件，方便分发。

开发约定：每次完成新的开发任务后，都要重新运行 `npm run build:single`，确保 `dist/Claude对话展示器.html` 是最新版本。

核心文件：

- `frontend/index.html`: 开发入口页面
- `frontend/app.js`: Vue 应用逻辑
- `frontend/importer.js`: 浏览器端 Claude 导出包解析逻辑
- `frontend/styles.css`: 页面样式
- `scripts/build-single-html.js`: 单文件 HTML 构建脚本
- `scripts/copy-vendor.js`: 复制前端第三方依赖

### 支持的 Claude 导出结构

```text
Claude项目/
  conversations.json
  memories.json
  users.json
  projects/
    <project_uuid>.json
```

### 构建单文件版本

开发者需要安装依赖并构建一次：

```bash
npm install
npm run build:single
```

产物位于：

```text
dist/Claude对话展示器.html
```

把这个 HTML 文件发给普通用户即可。

### 开发运行

当前前端不依赖后端 API。开发时可以直接打开：

```text
frontend/index.html
```

也可以用任意静态服务器打开 `frontend/` 目录。

如果仍想使用旧 Flask 静态服务入口：

```bash
python3 -m pip install -r requirements.txt
npm install
python3 backend/app.py
```

然后打开：

```text
http://127.0.0.1:5000
```

### 会话数据结构

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

前端默认隐藏 `tool_use`、`tool_result`、`server_tool_use`、`web_search_tool_result`、`token_budget` 类型内容块。

### 测试

```bash
python3 -m unittest tests/test_claude_parser.py
```

浏览器端 importer 的基础验证可以通过 `npm run build:single` 检查构建是否成功。构建脚本会把 Vue、JSZip、Mermaid 和应用代码内嵌到单个 HTML。

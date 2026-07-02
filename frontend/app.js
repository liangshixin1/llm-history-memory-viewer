const { createApp, computed, nextTick, ref, watch } = Vue;

let isMermaidConfigured = false;

function configureMermaid() {
  if (!window.mermaid || isMermaidConfigured) return;

  window.mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    themeVariables: {
      background: "#fffdf8",
      primaryColor: "#e9f4f1",
      primaryTextColor: "#24211d",
      primaryBorderColor: "#1f7a6b",
      lineColor: "#766f67",
      secondaryColor: "#fff8e8",
      tertiaryColor: "#f4f1eb",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    },
  });
  isMermaidConfigured = true;
}

configureMermaid();

createApp({
  setup() {
    const conversations = ref([]);
    const selectedConversation = ref(null);
    const stats = ref(null);
    const warnings = ref([]);
    const users = ref([]);
    const memories = ref([]);
    const projects = ref([]);
    const error = ref("");
    const query = ref("");
    const isLoading = ref(false);
    const isDragging = ref(false);
    const showProfileImport = ref(true);
    const viewMode = ref("reader");
    const conversationSortOrder = ref("desc");
    const migrationRange = ref("6m");
    const customStart = ref("");
    const customEnd = ref("");
    const copyStatus = ref({});

    const hiddenBlockTypes = new Set(["tool_use", "tool_result", "server_tool_use", "web_search_tool_result", "token_budget"]);
    const rangeOptions = [
      { value: "3m", label: "3个月" },
      { value: "6m", label: "6个月" },
      { value: "1y", label: "1年" },
      { value: "all", label: "所有" },
      { value: "custom", label: "自定" },
    ];

    const filteredConversations = computed(() => {
      const keyword = query.value.toLowerCase();
      const filtered = keyword
        ? conversations.value.filter((conversation) => {
            const haystack = [
              conversation.title,
              conversation.summary,
              ...conversation.messages.map((message) => message.text),
            ]
              .join("\n")
              .toLowerCase();
            return haystack.includes(keyword);
          })
        : [...conversations.value];

      return filtered.sort(compareConversationsByDate);
    });

    const conversationHeatmap = computed(() => {
      return buildConversationHeatmap(conversations.value);
    });

    const selectedAccountId = computed(() => {
      return selectedConversation.value?.account_id || memories.value[0]?.account_uuid || users.value[0]?.uuid || "";
    });

    const activeUser = computed(() => {
      return users.value.find((user) => user.uuid === selectedAccountId.value) || users.value[0] || null;
    });

    const userDisplayName = computed(() => {
      return activeUser.value?.full_name || "我";
    });

    const userInitial = computed(() => {
      const name = userDisplayName.value.trim();
      return name ? Array.from(name)[0] : "我";
    });

    const migrationConversations = computed(() => {
      const range = getMigrationRange();
      return conversations.value
        .filter((conversation) => {
          if (!range.start && !range.end) return true;
          const date = parseDate(conversation.updated_at || conversation.created_at);
          if (!date) return false;
          if (range.start && date < range.start) return false;
          if (range.end && date > range.end) return false;
          return true;
        })
        .sort((a, b) => {
          return String(a.created_at || "").localeCompare(String(b.created_at || ""));
        });
    });

    const migrationPrompt = computed(() => {
      return buildMigrationPrompt();
    });

    async function parseFile(file) {
      if (!file) return;
      error.value = "";
      isLoading.value = true;

      try {
        const payload = await window.ClaudeImporter.parseExportFile(file);

        conversations.value = payload.conversations || [];
        stats.value = payload.stats || null;
        warnings.value = payload.warnings || [];
        users.value = payload.users || [];
        memories.value = payload.memories || [];
        projects.value = payload.projects || [];
        showProfileImport.value = !hasProfilePayload(payload);
        selectedConversation.value = [...conversations.value].sort(compareConversationsByDate)[0] || null;
      } catch (err) {
        error.value = err.message;
      } finally {
        isLoading.value = false;
        isDragging.value = false;
      }
    }

    function handleFileChange(event) {
      parseFile(event.target.files?.[0]);
      event.target.value = "";
    }

    function handleDrop(event) {
      parseFile(event.dataTransfer.files?.[0]);
    }

    async function readJsonFile(file) {
      if (!file) return null;
      const text = await file.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`${file.name} 不是有效 JSON：${err.message}`);
      }
    }

    async function handleUsersFile(event) {
      error.value = "";
      try {
        const payload = await readJsonFile(event.target.files?.[0]);
        users.value = normalizeArray(payload).filter((item) => item && typeof item === "object");
      } catch (err) {
        error.value = err.message;
      } finally {
        event.target.value = "";
      }
    }

    async function handleMemoriesFile(event) {
      error.value = "";
      try {
        const payload = await readJsonFile(event.target.files?.[0]);
        memories.value = normalizeArray(payload).filter((item) => item && typeof item === "object");
      } catch (err) {
        error.value = err.message;
      } finally {
        event.target.value = "";
      }
    }

    async function handleProjectsFile(event) {
      error.value = "";
      try {
        const payload = await readJsonFile(event.target.files?.[0]);
        projects.value = normalizeArray(payload).filter((item) => item && typeof item === "object");
      } catch (err) {
        error.value = err.message;
      } finally {
        event.target.value = "";
      }
    }

    function selectConversation(conversation) {
      selectedConversation.value = conversation;
      viewMode.value = "reader";
    }

    function normalizeArray(payload) {
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === "object") return [payload];
      return [];
    }

    function hasProfilePayload(payload) {
      return Boolean((payload.users || []).length || (payload.memories || []).length || (payload.projects || []).length);
    }

    function visibleBlocks(message) {
      return (message.blocks || []).filter((block) => !hiddenBlockTypes.has(block.type));
    }

    function memoryBody(memory) {
      if (!memory || typeof memory !== "object") return "";
      return memory.conversations_memory || memory.memory || memory.text || JSON.stringify(memory, null, 2);
    }

    function splitTextSegments(text) {
      if (!text) return [];

      const segments = [];
      const fencePattern = /(^|\n)(```|~~~)([^\n`]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
      let cursor = 0;
      let match;

      while ((match = fencePattern.exec(text)) !== null) {
        const fenceStart = match.index + match[1].length;
        const plainText = text.slice(cursor, fenceStart);
        if (plainText) {
          segments.push({ type: "text", text: plainText });
        }

        const info = (match[3] || "").trim();
        const language = info.split(/\s+/)[0].toLowerCase();
        const code = match[4].trim();

        if (language === "mermaid") {
          segments.push({
            type: "mermaid",
            text: code,
            title: info.replace(/^mermaid\s*/i, "").trim(),
          });
        } else {
          segments.push({
            type: "code",
            text: match[4],
            language,
          });
        }

        cursor = fencePattern.lastIndex;
      }

      const remainingText = text.slice(cursor);
      if (remainingText) {
        segments.push({ type: "text", text: remainingText });
      }

      return segments.length ? segments : [{ type: "text", text }];
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function renderInlineMarkdown(value) {
      const tokens = [];
      let raw = String(value || "");

      raw = raw.replace(/`([^`\n]+)`/g, (_, code) => {
        const token = `\u0000TOKEN${tokens.length}\u0000`;
        tokens.push(`<code>${escapeHtml(code)}</code>`);
        return token;
      });

      raw = raw
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, formula) => {
          const token = `\u0000TOKEN${tokens.length}\u0000`;
          tokens.push(renderLatex(formula, true, "\\[", "\\]"));
          return token;
        })
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, formula) => {
          const token = `\u0000TOKEN${tokens.length}\u0000`;
          tokens.push(renderLatex(formula, false, "\\(", "\\)"));
          return token;
        })
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
          const token = `\u0000TOKEN${tokens.length}\u0000`;
          tokens.push(renderLatex(formula, true, "$$", "$$"));
          return token;
        })
        .replace(/(^|[^\w\\])\$([^\s$][\s\S]*?[^\s$])\$(?![\w])/g, (_, prefix, formula) => {
          const token = `\u0000TOKEN${tokens.length}\u0000`;
          tokens.push(renderLatex(formula, false, "$", "$"));
          return `${prefix}${token}`;
        });

      let html = escapeHtml(raw);

      html = html
        .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__([\s\S]+?)__/g, "<strong>$1</strong>")
        .replace(/(^|[^\*])\*([^\*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
        .replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

      tokens.forEach((content, index) => {
        html = html.replace(`\u0000TOKEN${index}\u0000`, content);
      });

      return html;
    }

    function renderLatex(formula, displayMode, leftDelimiter, rightDelimiter) {
      const source = String(formula || "").trim();
      if (!source) return "";

      if (!window.katex) {
        return escapeHtml(`${leftDelimiter}${source}${rightDelimiter}`);
      }

      try {
        return window.katex.renderToString(source, {
          displayMode,
          throwOnError: false,
          strict: "ignore",
          trust: false,
        });
      } catch (err) {
        return escapeHtml(`${leftDelimiter}${source}${rightDelimiter}`);
      }
    }

    function parseTableRow(line) {
      let value = line.trim();
      if (value.startsWith("|")) value = value.slice(1);
      if (value.endsWith("|")) value = value.slice(0, -1);
      return value.split("|").map((cell) => cell.trim());
    }

    function isTableDivider(line) {
      return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    }

    function isTableStart(lines, index) {
      return Boolean(lines[index + 1] && lines[index].includes("|") && isTableDivider(lines[index + 1]));
    }

    function renderMarkdown(text) {
      if (!text) return "";

      const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
      const html = [];
      let index = 0;

      const isBlockStart = (line) =>
        /^(#{1,6})\s+/.test(line.trim()) ||
        /^[-*_]{3,}$/.test(line.trim()) ||
        /^\s*[-*+]\s+/.test(line) ||
        /^\s*\d+[.)]\s+/.test(line) ||
        /^\s*>/.test(line);

      while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
          index += 1;
          continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
          index += 1;
          continue;
        }

        if (/^[-*_]{3,}$/.test(trimmed)) {
          html.push("<hr>");
          index += 1;
          continue;
        }

        if (isTableStart(lines, index)) {
          const headers = parseTableRow(lines[index]);
          index += 2;
          const rows = [];
          while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
            rows.push(parseTableRow(lines[index]));
            index += 1;
          }

          html.push(
            `<div class="table-wrap"><table><thead><tr>${headers
              .map((header) => `<th>${renderInlineMarkdown(header)}</th>`)
              .join("")}</tr></thead><tbody>${rows
              .map(
                (row) =>
                  `<tr>${headers
                    .map((_, columnIndex) => `<td>${renderInlineMarkdown(row[columnIndex] || "")}</td>`)
                    .join("")}</tr>`
              )
              .join("")}</tbody></table></div>`
          );
          continue;
        }

        if (/^\s*[-*+]\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
            items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*[-*+]\s+/, ""))}</li>`);
            index += 1;
          }
          html.push(`<ul>${items.join("")}</ul>`);
          continue;
        }

        if (/^\s*\d+[.)]\s+/.test(line)) {
          const items = [];
          while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
            items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
            index += 1;
          }
          html.push(`<ol>${items.join("")}</ol>`);
          continue;
        }

        if (/^\s*>/.test(line)) {
          const quote = [];
          while (index < lines.length && /^\s*>/.test(lines[index])) {
            quote.push(lines[index].replace(/^\s*>\s?/, ""));
            index += 1;
          }
          html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
          continue;
        }

        const paragraph = [];
        while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
          paragraph.push(renderInlineMarkdown(lines[index]));
          index += 1;
        }
        html.push(`<p>${paragraph.join("<br>")}</p>`);
      }

      return html.join("");
    }

    function parseDate(value) {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function compareConversationsByDate(a, b) {
      const aTime = conversationTime(a);
      const bTime = conversationTime(b);
      if (aTime !== bTime) {
        return conversationSortOrder.value === "asc" ? aTime - bTime : bTime - aTime;
      }
      return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
    }

    function conversationTime(conversation) {
      const date = parseDate(conversation?.updated_at || conversation?.created_at);
      return date ? date.getTime() : 0;
    }

    function conversationDayKey(conversation) {
      const date = parseDate(conversation?.updated_at || conversation?.created_at);
      if (!date) return "";
      return toDayKey(date);
    }

    function toDayKey(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function buildConversationHeatmap(items) {
      const counts = new Map();
      let minTime = Infinity;
      let maxTime = -Infinity;

      items.forEach((conversation) => {
        const key = conversationDayKey(conversation);
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
        const time = new Date(`${key}T00:00:00`).getTime();
        minTime = Math.min(minTime, time);
        maxTime = Math.max(maxTime, time);
      });

      if (!counts.size) {
        return { days: [], weeks: [], totalDays: 0, maxCount: 0 };
      }

      const maxSpanDays = 371;
      const startTime = Math.max(minTime, maxTime - (maxSpanDays - 1) * 86400000);
      const start = new Date(startTime);
      const end = new Date(maxTime);
      start.setDate(start.getDate() - start.getDay());
      end.setDate(end.getDate() + (6 - end.getDay()));

      const maxCount = Math.max(...counts.values());
      const days = [];
      const weeks = [];
      const cursor = new Date(start);

      while (cursor <= end) {
        const key = toDayKey(cursor);
        const count = counts.get(key) || 0;
        const day = {
          key,
          count,
          level: heatmapLevel(count, maxCount),
          tooltip: `${key}: ${count} 场对话`,
        };
        days.push(day);

        const weekIndex = Math.floor((days.length - 1) / 7);
        if (!weeks[weekIndex]) weeks[weekIndex] = [];
        weeks[weekIndex].push(day);

        cursor.setDate(cursor.getDate() + 1);
      }

      return {
        days,
        weeks,
        totalDays: counts.size,
        maxCount,
      };
    }

    function heatmapLevel(count, maxCount) {
      if (!count) return 0;
      if (maxCount <= 1) return 2;
      return Math.max(1, Math.min(4, Math.ceil((count / maxCount) * 4)));
    }

    function getMigrationRange() {
      if (migrationRange.value === "all") return { start: null, end: null };

      if (migrationRange.value === "custom") {
        return {
          start: customStart.value ? new Date(`${customStart.value}T00:00:00`) : null,
          end: customEnd.value ? new Date(`${customEnd.value}T23:59:59`) : null,
        };
      }

      const end = new Date();
      const start = new Date(end);
      if (migrationRange.value === "3m") start.setMonth(start.getMonth() - 3);
      if (migrationRange.value === "6m") start.setMonth(start.getMonth() - 6);
      if (migrationRange.value === "1y") start.setFullYear(start.getFullYear() - 1);
      return { start, end };
    }

    function buildMigrationPrompt() {
      const memoryText = memories.value
        .map((memory, index) => {
          const body = memory.conversations_memory || memory.memory || memory.text || JSON.stringify(memory, null, 2);
          return `### Memory ${index + 1}\n${body}`;
        })
        .join("\n\n");

      const overviewText = migrationConversations.value
        .map((conversation, index) => {
          const created = conversation.created_at || "unknown";
          const updated = conversation.updated_at || "unknown";
          const summary = conversation.summary || "（无摘要）";
          return `### Conversation ${index + 1}: ${conversation.title}\n- uuid: ${conversation.id}\n- created_at: ${created}\n- updated_at: ${updated}\n- messages: ${conversation.message_count}\n\n${summary}`;
        })
        .join("\n\n");

      const projectText = projects.value
        .map((project, index) => {
          const docs = (project.docs || [])
            .map((doc, docIndex) => {
              return `#### Project ${index + 1}.${docIndex + 1}: ${doc.filename || "未命名文档"}\n${doc.content || "（空文档）"}`;
            })
            .join("\n\n");

          return `### Project ${index + 1}: ${project.name || "未命名项目"}\n- uuid: ${
            project.id || project.uuid || "unknown"
          }\n- created_at: ${project.created_at || "unknown"}\n- updated_at: ${project.updated_at || "unknown"}\n- description: ${
            project.description || "（无）"
          }\n- prompt_template: ${project.prompt_template || "（无）"}\n- docs: ${(project.docs || []).length}\n\n${
            docs || "（无项目文档）"
          }`;
        })
        .join("\n\n");

      const user = activeUser.value;
      const range = getMigrationRange();
      const rangeLabel =
        migrationRange.value === "all"
          ? "所有会话"
          : migrationRange.value === "custom"
          ? `${customStart.value || "不限开始"} 至 ${customEnd.value || "不限结束"}`
          : rangeOptions.find((option) => option.value === migrationRange.value)?.label || migrationRange.value;

      return `# 大模型用户上下文迁移系统提示词

你将接收一份从旧大模型平台导出的用户长期交互资料包。你的任务不是简单复述资料，而是从中重建一份可迁移到新大模型平台的“用户理解档案与长期协作记忆草案”。

请保持严谨、克制、可执行。不要臆测，不要美化，不要把一次性请求误判为长期偏好。所有重要判断都应标注证据来源类型与置信度。

请注意：本提示词本身不是用户事实。只有下方资料包中的内容，才可作为分析依据。

---

## 你的角色

你是“用户上下文迁移与长期记忆建模专家”。

你的目标是帮助目标大模型快速理解用户的长期背景、重要项目、沟通偏好、协作方式和隐私边界，使目标模型在未来对话中更像一个熟悉用户的长期协作者、知心者与好伙伴，而不是一次性客服。

你需要生成的不是营销画像，也不是心理诊断，而是一份实用、可更新、可迁移的用户上下文档案。

---

## 资料来源优先级

请按以下优先级分析资料：

1. 平台长期记忆 / memory：优先级最高，但仍需注意其可能过期。
2. 项目资料 / projects：用于理解用户长期项目、文件结构、创作或工作背景。
3. 会话概览 / conversation overview：用于理解、补充近期任务、风格和阶段性变化。
4. 原始消息片段：如有提供，可用于校验细节，但不要大段复述。

如不同来源存在冲突，请明确列出冲突，不要强行合并。
如信息可能已经过期，请标注“可能需确认”。

---

## 证据与置信度规则

每条重要结论应尽量包含：

- 内容：你提炼出的用户事实、偏好或项目背景。
- 证据来源：memory / project / overview / raw conversation / repeated pattern / inference。在每个条目后，括号注明，如：（Memory 1, Conversation 3）。
- 置信度：高 / 中 / 低。
- 使用场景：未来模型应在什么情况下使用这条记忆。

置信度判断参考：

- 高置信：多次出现，或来自长期记忆，或由用户明确陈述。
- 中置信：来自较可靠的会话概览，但出现次数有限。
- 低置信：只出现一次、语境不完整、可能是临时情绪或推测。

---

## 输出总原则

请用中文输出。

请区分以下类型：

- 事实：用户明确说过或资料明确记录的客观信息。
- 偏好：用户反复表现出的回答、语气、格式、工具或审美偏好。
- 项目：用户长期推进的工作、学习、创作、技术或生活项目。
- 关系：只记录对协作有必要的关系背景，不展开隐私细节。
- 创作设定：用户作品中的虚构设定，必须与现实身份区分。
- 推测：必须标注为推测，不得写入最终长期记忆。
- 临时状态：如短期情绪、一次性任务、当天安排，除非反复出现，否则不写入长期记忆。

---

## 隐私与敏感信息边界

请不要输出或强调以下内容：

- 邮箱、电话、住址、身份证、账号 UUID 等直接识别信息。
- 原始聊天记录中的大段私人内容。
- 用户未明确要求长期记忆的敏感细节。
- 对健康、心理、政治、宗教、性取向、家庭创伤、财务状况等敏感领域的过度推断。

如资料中确有敏感信息，只有在它对未来协作明显必要时，才可用概括性语言记录为“支持方式、边界或注意事项”，不要写成标签化判断。

禁止进行心理诊断、人格定型、道德评判或命运式推断。

---

## 输出结构

请严格按以下结构输出。

### 1. 用户基础画像

概括用户的称呼、常用身份、主要生活/工作/学习语境、长期兴趣与能力结构。
如资料不足，请写“资料未明确支持”。

### 2. 当前主要领域与长期目标

根据资料自动识别用户的主要领域，不要预设用户一定属于某种职业或身份。

可识别的领域包括但不限于：

- 工作 / 职业发展
- 学习 / 研究 / 考试
- 创作 / 写作 / 艺术项目
- 技术 / 编程 / 自动化工具
- 生活管理 / 财务 / 设备
- 健康与自我照护
- 社交关系 / 家庭关系
- 兴趣爱好 / 审美偏好

请列出用户正在长期推进的目标、阶段性任务、已完成事项和近期重点。

### 3. 沟通偏好与协作风格

总结用户喜欢怎样的回答方式，包括但不限于：

- 语气：正式 / 亲切 / 直接 / 幽默 / 克制等。
- 深度：简洁结论 / 深度分析 / 可执行步骤 / 创作共鸣等。
- 格式：表格、清单、分步骤、完整文案、代码、文件交付等。
- 追问方式：何时应该直接做，何时应该先确认。
- 禁忌：用户明确不喜欢的表达方式、空话、过度安慰、说教、敷衍等。

请把这些偏好转化为目标模型可执行的协作准则。

### 4. 重要项目档案

整理用户长期项目。每个项目建议包含：

- 项目名称
- 项目类型
- 当前阶段
- 核心目标
- 关键设定 / 关键文件 / 技术栈 / 交付物
- 已知约束
- 未来协作注意事项
- 置信度与证据来源

如果资料中没有长期项目，请写“未发现明确长期项目”。

### 5. 创作与审美档案

如资料中存在创作、写作、艺术、影像、音乐、角色设定、世界观等内容，请单独整理。

请保留作品名、人物名、主题、结构、意象、风格、平台计划、修订计划等重要专有信息。

请明确区分：

- 用户现实经历
- 用户创作偏好
- 作品中的虚构设定
- 用户对作品的审美判断

如果资料中没有创作相关内容，请写“资料未显示明显创作项目”。

### 6. 技术与工具记忆

如资料中存在编程、自动化、设备、软件、AI 工具、文件处理、数据分析等内容，请整理：

- 常用设备与平台
- 常用技术栈
- 常用工具
- 已开发或正在开发的项目
- 用户的技术能力水平
- 常见问题类型
- 未来模型在技术协作时应采用的方式

如果资料不足，请不要编造技术能力。

### 7. 工作、学习或专业事务记忆

如资料中存在工作、学习、科研、学校、公司、项目管理、行政事务、课程、材料申报等内容，请整理：

- 组织或场景
- 用户承担的职责类型
- 高频任务
- 常见文件或交付物
- 协作对象或组织结构中必要的信息
- 未来模型应如何帮助用户提高效率

不要制造不存在的职位头衔。
不要把临时任务误判为长期职责。

### 8. 情绪模式与支持方式

只总结资料明确支持的长期模式，不做诊断。

请重点回答：

- 用户在什么类型的情境下容易需要支持？
- 用户更接受什么样的安慰或分析？
- 用户不喜欢什么样的心理化、鸡汤化或居高临下表达？
- 未来模型应如何在情绪支持中保持真诚、边界和行动性？

如资料不足，请写“资料不足以可靠判断”。

### 9. 价值观、判断标准与边界

总结用户反复体现的价值观与判断标准，包括但不限于：

- 对真诚、效率、公平、尊严、自由、创造、关系、知识的看法
- 对文学、艺术、技术、职业、社会议题的审美或伦理立场
- 用户不希望目标模型越界的地方

请避免把用户的一次性激烈表达扩大成永久立场。

### 10. 高置信长期记忆清单

列出可直接迁移为长期记忆的条目。

每条格式如下：

- 内容：
- 类型：事实 / 偏好 / 项目 / 创作设定 / 协作准则 / 边界
- 证据来源：
- 置信度：
- 使用场景：
- 是否建议写入目标模型长期记忆：是 / 否 / 需确认

### 11. 低置信或需确认事项

列出资料中出现但不宜直接写入长期记忆的事项。

每条说明：

- 可能内容：
- 不确定原因：
- 建议未来如何向用户确认：

### 12. 不应记忆或不应过度推断的内容

列出不建议迁移的内容类型，包括：

- 一次性任务
- 短期情绪
- 过期安排
- 直接联系方式
- 过度私密信息
- 未经确认的敏感推测
- 仅属于某个作品内部的虚构设定
- 目标模型未来不需要主动提及的细节

### 13. 面向目标模型的长期协作准则

请用清晰、可执行的语言写出目标模型未来与该用户互动时应遵守的准则。

重点包括：

- 回答风格
- 追问策略
- 文件和技术任务处理方式
- 创作类任务处理方式
- 情绪支持方式
- 记忆更新方式
- 隐私边界

### 14. 最终可迁移 memory 草案

请把以上分析压缩成一段可直接提供给目标大模型的长期记忆文本。

要求：

- 只保留高置信、长期有用的信息。
- 不包含直接联系方式、账号标识或过度私密细节。
- 不包含明显过期的一次性任务。
- 不把推测写成事实。
- 长度控制在 800—1500 字之间。
- 语言应适合放入“用户长期记忆”或“系统上下文”中。

---

## 最后检查

输出前请自查：

1. 是否把一次性请求误判为长期偏好？
2. 是否把创作设定误判为现实经历？
3. 是否过度暴露隐私或敏感信息？
4. 是否标注了证据来源与置信度？
5. 是否给出了目标模型可执行的协作准则？
6. 是否保留了用户真正长期重要的项目、偏好和边界？
7. 是否避免了空泛赞美、心理诊断和无依据推断？

---

## 以下为待分析资料包

### 用户账号资料

${user ? `- full_name: ${user.full_name || "unknown"}\n- email: （已省略，仅用于账号匹配）\n- account id / uuid: （已省略，不得写入最终记忆）` : "（未导入 users.json）"}

### 打包范围

- 日期范围：${rangeLabel}
- 范围开始：${range.start ? range.start.toISOString() : "不限"}
- 范围结束：${range.end ? range.end.toISOString() : "不限"}
- 已装配 memory 条目：${memories.value.length}
- 已装配 conversation overview：${migrationConversations.value.length}
- 已装配 project：${projects.value.length}

### Claude Memories

${memoryText || "（未导入 memories.json，或文件中无可识别记忆）"}

### 会话 Overview

${overviewText || "（当前日期范围内没有会话摘要）"}

### 项目资料 Projects

${projectText || "（未导入 projects，或导出包中无项目文件）"}

### 其他补充资料

（当前未提供其他补充资料）

## 开始执行

请根据以上资料，生成完整的用户理解档案、长期协作记忆草案、可执行协作准则和最终可迁移 memory 草案。`;
    }

    function projectBody(project) {
      const docs = (project.docs || [])
        .map((doc, index) => `### ${index + 1}. ${doc.filename || "未命名文档"}\n\n${doc.content || "（空文档）"}`)
        .join("\n\n");
      return `# ${project.name || "未命名项目"}\n\n${project.description || "（无项目描述）"}\n\n${docs || "（无项目文档）"}`;
    }

    function codeCopyKey(message, blockIndex, segmentIndex) {
      return `${message.id || message.created_at}-${blockIndex}-${segmentIndex}`;
    }

    async function copyText(text, key = "copy") {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          textarea.remove();
        }
        copyStatus.value = { ...copyStatus.value, [key]: "已复制" };
        window.setTimeout(() => {
          const next = { ...copyStatus.value };
          delete next[key];
          copyStatus.value = next;
        }, 1400);
      } catch (err) {
        copyStatus.value = { ...copyStatus.value, [key]: "复制失败" };
      }
    }

    async function renderMermaid() {
      await nextTick();
      configureMermaid();
      if (!window.mermaid) return;

      document.querySelectorAll(".mermaid-diagram").forEach((diagram) => {
        diagram.removeAttribute("data-processed");
      });

      try {
        await window.mermaid.run({
          querySelector: ".mermaid-diagram",
        });
      } catch (err) {
        console.warn("Mermaid render failed", err);
      }
    }

    function senderLabel(sender) {
      const labels = {
        human: userDisplayName.value,
        assistant: "Claude",
      };
      return labels[sender] || sender || "未知";
    }

    function blockLabel(block) {
      if (block.name) return `${block.type} · ${block.name}`;
      return block.type || "内容块";
    }

    function formatDate(value) {
      if (!value) return "无日期";
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
    }

    function formatDateTime(value) {
      if (!value) return "";
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    }

    function formatNumber(value) {
      return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
    }

    watch(selectedConversation, () => {
      renderMermaid();
    });

    window.addEventListener("mermaid-ready", renderMermaid);

    return {
      conversations,
      selectedConversation,
      stats,
      warnings,
      users,
      memories,
      projects,
      selectedAccountId,
      activeUser,
      userDisplayName,
      userInitial,
      error,
      query,
      isLoading,
      isDragging,
      showProfileImport,
      viewMode,
      conversationSortOrder,
      migrationRange,
      customStart,
      customEnd,
      rangeOptions,
      migrationConversations,
      migrationPrompt,
      copyStatus,
      filteredConversations,
      conversationHeatmap,
      handleFileChange,
      handleDrop,
      handleUsersFile,
      handleMemoriesFile,
      handleProjectsFile,
      selectConversation,
      visibleBlocks,
      memoryBody,
      projectBody,
      splitTextSegments,
      renderMarkdown,
      copyText,
      codeCopyKey,
      senderLabel,
      blockLabel,
      formatDate,
      formatDateTime,
      formatNumber,
    };
  },
}).mount("#app");

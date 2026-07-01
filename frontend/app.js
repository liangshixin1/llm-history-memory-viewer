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
    const viewMode = ref("reader");
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
      if (!keyword) return conversations.value;

      return conversations.value.filter((conversation) => {
        const haystack = [
          conversation.title,
          conversation.summary,
          ...conversation.messages.map((message) => message.text),
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(keyword);
      });
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

      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch("/api/parse", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "解析失败。");
        }

        conversations.value = payload.conversations || [];
        stats.value = payload.stats || null;
        warnings.value = payload.warnings || [];
        users.value = payload.users || [];
        memories.value = payload.memories || [];
        projects.value = payload.projects || [];
        selectedConversation.value = conversations.value[0] || null;
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
      const codeSpans = [];
      let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, code) => {
        const token = `\u0000CODE${codeSpans.length}\u0000`;
        codeSpans.push(`<code>${code}</code>`);
        return token;
      });

      html = html
        .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__([\s\S]+?)__/g, "<strong>$1</strong>")
        .replace(/(^|[^\*])\*([^\*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
        .replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

      codeSpans.forEach((code, index) => {
        html = html.replace(`\u0000CODE${index}\u0000`, code);
      });

      return html;
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

      return `# 大模型人格迁移系统提示词

你将接收一份从 Claude 导出的用户长期交互资料包。你的任务不是简单复述资料，而是从中重建一个可迁移到新大模型平台的“用户画像与长期记忆系统”。请保持严谨、克制、可执行，避免臆测；所有判断都要标注置信度或证据来源类型。

## 你的角色

你是“人格迁移与长期记忆建模专家”。请基于下方资料，为目标大模型生成一份可长期使用的用户理解档案。该档案应帮助目标大模型在未来对话中更像一个熟悉用户的长期协作者，而不是一次性客服。

## 输出要求

请用中文输出，结构必须包含：

1. 用户身份与背景画像：姓名/称呼、工作场景、创作身份、技术能力、生活语境。
2. 长期目标与阶段性任务：职业转向、文学创作、工具开发、行政工作、研究项目等。
3. 偏好与沟通风格：喜欢怎样的回答、不喜欢怎样的回答、对语气/深度/直接性的要求。
4. 创作世界与作品档案：人物、作品、主题、结构、意象、修文计划、平台约束。
5. 技术与工具记忆：常用技术栈、项目、文件处理、自动化习惯、平台环境。
6. 工作事务记忆：学校、学院、评估、教材、数据表、文档、会议、项目材料等。
7. 情绪与心理模式：只总结资料明确支持的模式，避免诊断化标签；说明支持证据。
8. 价值观与审美：文学、美学、女性关系、理论框架、政治/社会寓言、表达边界。
9. 可持续协作准则：未来模型应该如何回应、如何追问、如何保存/更新记忆。
10. 高置信记忆清单：可直接迁移为长期记忆的条目，每条包含“内容 / 证据 / 置信度 / 使用场景”。
11. 低置信或需确认事项：不能确定但值得下次询问用户确认的事项。
12. 不应记忆或不应过度推断的内容：隐私、临时情绪、未经确认推测、敏感信息边界。
13. 面向目标模型的最终 system memory：请把上面分析压缩成一段可直接放入目标大模型长期记忆/系统提示中的文本。

## 分析规则

- 优先使用 Claude memory，其次使用会话 overview；两者冲突时列出冲突，不要强行合并。
- 不要泄露或强调用户邮箱、电话等直接联系信息；如资料中出现，只用于识别同一账号，不纳入最终可迁移记忆。
- 不要把用户的一次性请求误判为长期偏好。
- 区分“事实、偏好、项目、关系、创作设定、推测”。
- 对用户创作内容要保留专有名词、人物关系、主题结构和写作计划。
- 对用户工作内容要保留组织、职责、项目类型和常见任务模式，但不要制造不存在的职位头衔。
- 对用户沟通风格要提炼成可操作的协作准则。
- 最终结果应足够详细，使另一个大模型即使没有原始对话，也能理解用户的长期上下文。

## 用户账号资料

${user ? `- uuid: ${user.uuid || "unknown"}\n- full_name: ${user.full_name || "unknown"}\n- email: （已省略，仅用于账号匹配）` : "（未导入 users.json）"}

## 打包范围

- 日期范围：${rangeLabel}
- 范围开始：${range.start ? range.start.toISOString() : "不限"}
- 范围结束：${range.end ? range.end.toISOString() : "不限"}
- 已装配 memory 条目：${memories.value.length}
- 已装配 conversation overview：${migrationConversations.value.length}
- 已装配 project：${projects.value.length}

## Claude Memories

${memoryText || "（未导入 memories.json，或文件中无可识别记忆）"}

## Conversation Overviews

${overviewText || "（当前日期范围内没有会话摘要）"}

## Claude Projects

${projectText || "（未导入 projects，或导出包中无项目文件）"}

## 开始执行

请根据以上资料，生成完整的用户画像、长期记忆和迁移用 system memory。`;
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
      viewMode,
      migrationRange,
      customStart,
      customEnd,
      rangeOptions,
      migrationConversations,
      migrationPrompt,
      copyStatus,
      filteredConversations,
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
    };
  },
}).mount("#app");

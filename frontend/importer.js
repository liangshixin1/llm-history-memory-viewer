(function () {
  class ClaudeParseError extends Error {
    constructor(message) {
      super(message);
      this.name = "ClaudeParseError";
    }
  }

  async function parseExportFile(file) {
    if (!file) {
      throw new ClaudeParseError("请上传 Claude 导出 zip 或 JSON 文件。");
    }

    const filename = file.name || "";
    if (filename.toLowerCase().endsWith(".zip")) {
      return parseExportZip(file);
    }

    const data = await file.arrayBuffer();
    if (looksLikeZip(data)) {
      return parseExportZip(file);
    }

    const result = parseClaudeExport(await readFileText(file));
    return {
      conversations: result.conversations,
      stats: result.stats,
      warnings: result.warnings,
      users: [],
      memories: [],
      projects: [],
    };
  }

  async function parseExportZip(file) {
    if (!window.JSZip) {
      throw new ClaudeParseError("缺少 JSZip，无法解析 zip 文件。");
    }

    let archive;
    try {
      archive = await window.JSZip.loadAsync(await file.arrayBuffer());
    } catch (error) {
      throw new ClaudeParseError("上传的文件不是有效 zip。");
    }

    const warnings = [];
    let users = [];
    let memories = [];
    const projects = [];
    let conversationsResult = null;

    const names = Object.keys(archive.files).filter((name) => {
      const entry = archive.files[name];
      return !entry.dir && !isIgnoredZipEntry(name);
    });
    const byBasename = new Map(names.map((name) => [basename(name), name]));

    const conversationsName = byBasename.get("conversations.json");
    if (conversationsName) {
      conversationsResult = parseClaudeExport(await readZipText(archive, conversationsName));
      warnings.push(...conversationsResult.warnings);
    } else {
      warnings.push("zip 中未找到 conversations.json。");
    }

    const usersName = byBasename.get("users.json");
    if (usersName) {
      users = jsonList(JSON.parse(await readZipText(archive, usersName)));
    } else {
      warnings.push("zip 中未找到 users.json。");
    }

    const memoriesName = byBasename.get("memories.json");
    if (memoriesName) {
      memories = jsonList(JSON.parse(await readZipText(archive, memoriesName)));
    } else {
      warnings.push("zip 中未找到 memories.json。");
    }

    for (const name of [...names].sort()) {
      const parts = pathParts(name);
      if (parts.length >= 2 && parts.includes("projects") && name.toLowerCase().endsWith(".json")) {
        const project = JSON.parse(await readZipText(archive, name));
        if (project && typeof project === "object" && !Array.isArray(project)) {
          projects.push(normalizeProject(project, name));
        }
      }
    }

    if (!conversationsResult) {
      throw new ClaudeParseError("zip 中没有可解析的 conversations.json。");
    }

    return {
      conversations: conversationsResult.conversations,
      stats: {
        ...conversationsResult.stats,
        user_count: users.length,
        memory_count: memories.length,
        project_count: projects.length,
      },
      warnings,
      users,
      memories,
      projects,
    };
  }

  function parseClaudeExport(raw) {
    const warnings = [];
    const decoded = decodePayload(raw, warnings);
    const conversations = decoded.map(normalizeConversation);
    return {
      conversations,
      stats: buildStats(conversations, warnings),
      warnings,
    };
  }

  function decodePayload(raw, warnings) {
    const text = String(raw || "").replace(/^\ufeff/, "");

    try {
      return asConversationList(JSON.parse(text));
    } catch (error) {
      // Fall back to tolerant parsing below.
    }

    const objectStart = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index !== -1);
    if (!starts.length) {
      throw new ClaudeParseError("没有找到 JSON 对象或数组。");
    }

    const start = Math.min(...starts);
    if (start > 0) {
      warnings.push(`已忽略 JSON 前面的说明文字，共 ${start} 个字符。`);
    }

    const items = [];
    let index = start;

    while (index < text.length) {
      while (index < text.length && " \t\r\n,[]".includes(text[index])) {
        index += 1;
      }
      if (index >= text.length) break;

      const end = findJsonValueEnd(text, index);
      if (end === -1) {
        if (items.length) {
          warnings.push(`在第 ${index} 个字符附近停止解析；前面 ${items.length} 个会话已成功读取，后续内容可能被截断。`);
          break;
        }
        throw new ClaudeParseError("JSON 解析失败：内容可能被截断。");
      }

      try {
        items.push(...asConversationList(JSON.parse(text.slice(index, end))));
      } catch (error) {
        if (items.length) {
          warnings.push(`在第 ${index} 个字符附近停止解析；前面 ${items.length} 个会话已成功读取，后续内容可能被截断。`);
          break;
        }
        throw new ClaudeParseError(`JSON 解析失败：${error.message}`);
      }

      index = end;
    }

    if (!items.length) {
      throw new ClaudeParseError("没有解析到 Claude 会话对象。");
    }

    return items;
  }

  function findJsonValueEnd(text, start) {
    const opener = text[start];
    const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
    if (!closer) return -1;

    const stack = [closer];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) return index + 1;
      }
    }

    return -1;
  }

  function asConversationList(value) {
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    }
    if (value && typeof value === "object") {
      return [value];
    }
    return [];
  }

  function normalizeConversation(item) {
    const messages = (item.chat_messages || []).filter(isObject).map(normalizeMessage);
    const humanCount = messages.filter((message) => message.sender === "human").length;
    const assistantCount = messages.filter((message) => message.sender === "assistant").length;

    return {
      id: item.uuid || "",
      title: item.name || "未命名对话",
      summary: item.summary || "",
      created_at: item.created_at || "",
      updated_at: item.updated_at || "",
      account_id: isObject(item.account) ? item.account.uuid || "" : "",
      message_count: messages.length,
      human_count: humanCount,
      assistant_count: assistantCount,
      messages,
    };
  }

  function normalizeMessage(item) {
    const blocks = (item.content || []).filter(isObject).map(normalizeBlock);
    const text = item.text || joinBlockText(blocks);

    return {
      id: item.uuid || "",
      sender: item.sender || "unknown",
      created_at: item.created_at || "",
      updated_at: item.updated_at || "",
      parent_id: item.parent_message_uuid || "",
      text,
      attachments: item.attachments || [],
      files: item.files || [],
      blocks,
    };
  }

  function normalizeBlock(item) {
    const blockType = item.type || "unknown";
    let text = "";

    if (blockType === "text") {
      text = item.text || "";
    } else if (blockType === "thinking") {
      text = item.thinking || "";
    } else if (blockType === "tool_result") {
      text = toolResultText(item.content);
    } else {
      text = item.text || item.thinking || compactJson(item);
    }

    return {
      type: blockType,
      text,
      start_timestamp: item.start_timestamp,
      stop_timestamp: item.stop_timestamp,
      is_error: item.is_error,
      name: item.name || item.message,
      meta: blockMeta(item),
    };
  }

  function toolResultText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (isObject(item)) return String(item.text || item.content || compactJson(item));
          return String(item);
        })
        .filter(Boolean)
        .join("\n");
    }
    if (content == null) return "";
    return compactJson(content);
  }

  function blockMeta(item) {
    const omit = new Set(["text", "thinking", "content"]);
    return Object.fromEntries(
      Object.entries(item).filter(([key, value]) => {
        return !omit.has(key) && value != null && !(Array.isArray(value) && !value.length) && !(isObject(value) && !Object.keys(value).length);
      })
    );
  }

  function buildStats(conversations, warnings) {
    const senderCounts = {};
    const contentTypeCounts = {};
    let totalMessages = 0;
    let totalChars = 0;

    conversations.forEach((conversation) => {
      conversation.messages.forEach((message) => {
        totalMessages += 1;
        totalChars += countTextChars(message.text);
        senderCounts[message.sender] = (senderCounts[message.sender] || 0) + 1;
        message.blocks.forEach((block) => {
          contentTypeCounts[block.type] = (contentTypeCounts[block.type] || 0) + 1;
        });
      });
    });

    return {
      conversation_count: conversations.length,
      message_count: totalMessages,
      total_char_count: totalChars,
      sender_counts: senderCounts,
      content_type_counts: contentTypeCounts,
      has_warnings: Boolean(warnings.length),
    };
  }

  function countTextChars(value) {
    return String(value || "").replace(/\s/g, "").length;
  }

  function normalizeProject(project, sourcePath) {
    const docs = (project.docs || []).filter(isObject);
    return {
      id: project.uuid || "",
      name: project.name || "未命名项目",
      description: project.description || "",
      prompt_template: project.prompt_template || "",
      created_at: project.created_at || "",
      updated_at: project.updated_at || "",
      is_private: Boolean(project.is_private),
      is_starter_project: Boolean(project.is_starter_project),
      creator: project.creator || {},
      source_path: sourcePath,
      doc_count: docs.length,
      docs: docs.map((doc) => ({
        id: doc.uuid || "",
        filename: doc.filename || "未命名文档",
        content: doc.content || "",
        created_at: doc.created_at || "",
      })),
    };
  }

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function compactJson(value) {
    return JSON.stringify(value);
  }

  function joinBlockText(blocks) {
    return blocks.map((block) => block.text).filter(Boolean).join("\n\n");
  }

  function jsonList(value) {
    if (Array.isArray(value)) return value.filter(isObject);
    if (isObject(value)) return [value];
    return [];
  }

  function isIgnoredZipEntry(name) {
    const parts = pathParts(name);
    return basename(name) === ".DS_Store" || parts.includes("__MACOSX");
  }

  function basename(path) {
    const parts = pathParts(path);
    return parts[parts.length - 1] || "";
  }

  function pathParts(path) {
    return String(path).split(/[\\/]+/).filter(Boolean);
  }

  async function readZipText(archive, name) {
    return stripBom(await archive.files[name].async("text"));
  }

  async function readFileText(file) {
    return stripBom(await file.text());
  }

  function stripBom(value) {
    return String(value || "").replace(/^\ufeff/, "");
  }

  function looksLikeZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 4));
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  window.ClaudeImporter = {
    ClaudeParseError,
    parseExportFile,
    parseExportZip,
    parseClaudeExport,
  };
})();

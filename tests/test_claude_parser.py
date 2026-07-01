import unittest
from io import BytesIO
from zipfile import ZipFile

from backend.app import parse_export_file
from backend.claude_parser import ClaudeParseError, parse_claude_export


class ClaudeParserTest(unittest.TestCase):
    def test_parses_single_conversation(self):
        raw = """
        {
          "uuid": "c1",
          "name": "测试",
          "summary": "摘要",
          "created_at": "2025-01-01T00:00:00Z",
          "chat_messages": [
            {
              "uuid": "m1",
              "sender": "human",
              "created_at": "2025-01-01T00:00:01Z",
              "text": "你好",
              "content": [{"type": "text", "text": "你好"}]
            }
          ]
        }
        """

        result = parse_claude_export(raw)

        self.assertEqual(result.stats["conversation_count"], 1)
        self.assertEqual(result.conversations[0]["title"], "测试")
        self.assertEqual(result.conversations[0]["messages"][0]["blocks"][0]["text"], "你好")

    def test_parses_prefixed_object_sequence_and_warns_on_truncation(self):
        raw = (
            "说明文字："
            '{"uuid":"c1","name":"一","chat_messages":[]},'
            '{"uuid":"c2","name":"二","chat_messages":[]},'
            '{"uuid":"broken","name":'
        )

        result = parse_claude_export(raw)

        self.assertEqual(result.stats["conversation_count"], 2)
        self.assertEqual([item["title"] for item in result.conversations], ["一", "二"])
        self.assertTrue(result.warnings)

    def test_raises_when_no_json_exists(self):
        with self.assertRaises(ClaudeParseError):
            parse_claude_export("不是 JSON")

    def test_parses_claude_zip_bundle(self):
        conversations = """
        [
          {
            "uuid": "c1",
            "name": "会话",
            "summary": "摘要",
            "created_at": "2025-01-01T00:00:00Z",
            "chat_messages": []
          }
        ]
        """
        users = '[{"uuid":"u1","full_name":"测试用户"}]'
        memories = '[{"account_uuid":"u1","conversations_memory":"长期记忆"}]'
        project = '{"uuid":"p1","name":"项目","docs":[{"uuid":"d1","filename":"doc.txt","content":"文档内容"}]}'

        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("conversations.json", conversations)
            archive.writestr("users.json", users)
            archive.writestr("memories.json", memories)
            archive.writestr("projects/p1.json", project)

        payload = parse_export_file(buffer.getvalue(), "claude-export.zip")

        self.assertEqual(payload["stats"]["conversation_count"], 1)
        self.assertEqual(payload["users"][0]["full_name"], "测试用户")
        self.assertEqual(payload["memories"][0]["conversations_memory"], "长期记忆")
        self.assertEqual(payload["projects"][0]["name"], "项目")
        self.assertEqual(payload["projects"][0]["docs"][0]["filename"], "doc.txt")


if __name__ == "__main__":
    unittest.main()

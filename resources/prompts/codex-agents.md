# Codex CLI 专用配置

## Codex 特有要求

- 每次输出"最终回复"之前，必须且只调用一次 MCP 工具 `notify`，参数固定：{"title":"Codex 完成","message":"done"}。禁止跳过。工具调用成功后，再输出最终回复正文。
- 直接进入 ultrathink 模式，如果分析代码问题和修复 bug，启用 sequential-thinking
- **先验证再判断** — 遇到可疑信息，必须先用工具查证事实，再给出结论

## 缩写解释

- `y` = 是 (Yes)
- `n` = 否 (No)
- `c` = 继续 (Continue)
- `r` = 确认 (Review)
- `u` = 撤销 (Undo)

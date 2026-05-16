# 技术规格说明

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Electron 42.x | 跨平台桌面应用框架 |
| 前端 | HTML + CSS + 原生 JS | 无需额外框架，保持轻量 |
| 数据库 | sql.js 1.x | SQLite 的 WASM 编译版，纯 JS 无需编译 |
| 打包 | electron-builder | 生成 Windows .exe 安装包 |

## 架构

```
┌──────────────────────────────────────┐
│           Main Process（主进程）       │
│                                      │
│  ┌──────────┐  ┌──────────────────┐  │
│  │ 剪贴板监听 │  │   数据库 (sql.js) │  │
│  │ (轮询)    │  │   CRUD + 清理    │  │
│  └──────────┘  └──────────────────┘  │
│  ┌──────────┐  ┌──────────────────┐  │
│  │ 系统托盘   │  │   窗口管理        │  │
│  │ Tray API  │  │   BrowserWindow  │  │
│  └──────────┘  └──────────────────┘  │
│         │ IPC 通信 (contextBridge)     │
├─────────┼────────────────────────────┤
│         ↓                            │
│      Renderer Process（渲染进程）       │
│  ┌─────────────────────────────────┐ │
│  │         UI (HTML/CSS/JS)        │ │
│  │  卡片列表 · 搜索 · 设置 · 粘贴   │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## 数据流

```
用户 Ctrl+C → 剪贴板变化 → 监听器检测 → 去重判断
    → 写入数据库 → IPC 通知渲染进程 → UI 更新卡片列表

用户点击卡片 → IPC 通知主进程 → 写回剪贴板 → 模拟 Ctrl+V
    → 窗口隐藏

用户搜索 → 前端本地过滤（文字记录在内存中）→ 重新渲染

用户置顶/删除 → IPC 通知主进程 → 更新数据库 → 刷新列表
```

## 进程通信（IPC）

使用 Electron 的 `contextBridge` + `ipcRenderer/ipcMain`：

| 通道名 | 方向 | 作用 |
|--------|------|------|
| `clipboard:new-item` | 主→渲染 | 推送新记录 |
| `clipboard:get-all` | 渲染→主 | 获取全部记录 |
| `clipboard:search` | 渲染→主 | 搜索记录 |
| `clipboard:pin` | 渲染→主 | 置顶/取消置顶 |
| `clipboard:delete` | 渲染→主 | 删除记录 |
| `clipboard:paste` | 渲染→主 | 粘贴到当前窗口 |
| `settings:get` | 渲染→主 | 读取设置 |
| `settings:set` | 渲染→主 | 保存设置 |

## 数据库设计

表名：`clipboard_items`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| type | TEXT | `text` 或 `image` |
| content | TEXT | 文字内容 或 图片文件路径 |
| pinned | INTEGER | 0=普通 1=置顶 |
| created_at | TEXT | ISO 8601 时间戳 |

表名：`settings`

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | 设置键名 |
| value | TEXT | 设置值 |

## 存储路径

- 数据库文件：`%APPDATA%/clipboard-history/data.db`
- 图片文件：`%APPDATA%/clipboard-history/images/`
- 设置存储：同一数据库 `settings` 表

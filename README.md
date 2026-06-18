# 安全隐患排查治理助手 Web 版

面向施工现场隐患排查的响应式 Web 应用，支持桌面网页和手机浏览器访问。

## 功能

- 账号密码登录，默认管理员和普通用户，首次登录强制修改复杂密码。
- 手机拍照或上传隐患照片。
- 服务端预留百炼大模型接口，生成“隐患描述”和“整改建议”草稿。
- 用户可编辑 AI 文本，点击保存后才写入正式台账。
- 历史台账查看、筛选、勾选批量导出 Excel。
- 管理员用户管理和安全审计。

## 启动

```bash
npm install
npm run build
npm start
```

访问：

```text
http://localhost:8787
```

首次启动会在控制台打印默认账号临时密码。请登录后立即修改。

默认账号：

- `admin`：管理员
- `inspector01`：普通用户

## 百炼配置

复制 `.env.example` 为 `.env`，填写服务端环境变量：

```text
DASHSCOPE_API_KEY=你的百炼Key
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen-vl-plus
```

Key 只在服务端使用，前端不会展示或保存。未配置 Key 时，上传图片仍会生成可编辑草稿，用户可以手动填写隐患描述和整改建议后保存。

## 公网部署提醒

- 设置足够长的 `SESSION_SECRET`。
- 使用 HTTPS 反向代理。
- 将 `data/` 和 `uploads/` 放到持久化目录并定期备份。
- 正式公网建议接入 WAF、访问限流、日志留存和二次验证。

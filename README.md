# news-daily-reporter

一个 Chrome 插件：按固定时间从平台采集候选内容，交给 AI 过滤/排序后，通过 Telegram 推送 5-10 条摘要与原文链接。

## 功能

- 定时执行（精确到分钟）
- 采集来源
  - 知乎：按关键词站内搜索获取候选内容
  - X：按关键词搜索获取候选内容（通常需要登录）
  - Reddit：从订阅社区与额外社区获取热点（通常需要登录）
- AI 筛选：按各平台关键词做相关性筛选与摘要，输出 5-10 条
- Telegram 推送：将报告发送到指定 Chat
- 去重：按去重周期避免重复推送同一链接

默认只启用知乎采集；X/Reddit 需要在设置页手动勾选开启。

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目目录

## 使用

1. 点击扩展图标，打开弹窗
2. 点击「打开设置」进入选项页，完成以下配置：
   - 定时任务：是否启用、执行时间（小时/分钟）、去重周期
   - 采集平台：勾选需要的平台（默认仅知乎）
   - 关键词：
     - 知乎关键词：用标签方式维护
     - X 关键词：逗号分隔
     - Reddit 关键词：逗号分隔
   - Reddit 配置：是否使用订阅社区、额外社区（可选）
   - Telegram：Bot Token 与 Chat ID
   - AI：API URL、API Key、模型名（可选自定义 Prompt）
3. 回到弹窗，可以：
   - 点击「立即采集」立刻生成一次报告
   - 查看当前启用的平台与各平台关键词摘要
   - 快速勾选/保存采集平台开关

## 平台说明

- 知乎：优先使用站内搜索接口获取候选内容，链接会被标准化为可直接打开的网页链接。
- X：页面结构与风控变化较频繁，未登录或触发限制时可能采集为空。
- Reddit：
  - 使用订阅社区模式会读取你的订阅列表，因此通常需要登录。
  - 也可以在「额外社区」中手动填写社区名（支持 `r/xxx` 或 `xxx`）。

## 常见问题

- 为什么没有自动推送？
  - 确认选项页已启用定时任务，并设置了执行时间（小时/分钟）。
  - 确认 Telegram 与 AI 配置完整；未配置 Token/Key 时可能生成失败或无推送。
  - 部分平台需要登录，未登录时候选内容可能为空，最终被筛选后也可能不足 5 条。
- 为什么链接打不开？
  - 已对知乎 API 链接做了网页链接标准化；如果仍遇到不可打开链接，请提 issue 并附上样例链接。

## 开发结构

- [manifest.json](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/manifest.json)：扩展声明与权限
- [js/background.js](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/js/background.js)：定时、采集、AI 过滤、Telegram 推送
- [options.html](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/options.html) / [js/options.js](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/js/options.js)：配置页
- [popup.html](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/popup.html) / [js/popup.js](file:///Volumes/KeSilentA/Code/个人项目/news-daily-reporter/js/popup.js)：弹窗

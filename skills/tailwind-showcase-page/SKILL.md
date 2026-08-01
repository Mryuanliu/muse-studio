---
name: tailwind-showcase-page
description: 生成普通展示类/H5 页面，使用 Next.js + Tailwind CSS，移动端优先。
version: 0.1.0
---

# Tailwind Showcase Page

用于生成普通展示类页面、落地页、活动页、信息展示页和移动端 H5。

## 项目要求

- 使用 Next.js App Router 生成工程化项目。
- 只使用 Tailwind CSS 作为样式方案，不引入 antd、antd-mobile 或其他组件库。
- 优先移动端布局，再适配桌面端；所有文案不得溢出容器。
- 页面必须能在沙箱中通过 MCP preview 启动并访问。

## 组件规范

- 使用 Tailwind 工具类自建轻量组件：按钮、输入框、卡片、导航栏、弹层、空状态、加载态。
- 图标统一使用 lucide-react，不手写 SVG 装饰。
- 配色避免单一色系，保持至少一组清晰的背景、主色、辅助色和文字色。
- 卡片圆角不超过 8px，按钮和输入框使用稳定的最小尺寸。

## 交付约束

- 所有文件写入当前项目工作区，不写外部绝对路径。
- 页面完成后必须执行 `npm run build` 或启动 dev server 验证。
- 完成后使用中文总结项目结构、页面路径、预览地址和主要交互。

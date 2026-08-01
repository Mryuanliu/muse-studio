---
name: tailwind-admin-page
description: 生成后台类页面，使用 Next.js + Tailwind CSS，包含菜单、列表、表单、详情和状态管理。
version: 0.1.0
---

# Tailwind Admin Page

用于生成后台管理类页面，例如任务列表、数据表格、表单、详情、仪表盘和配置管理。

## 项目要求

- 使用 Next.js App Router 生成工程化项目。
- 只使用 Tailwind CSS 作为样式方案，不引入 antd、antd-mobile 或其他组件库。
- 页面必须有稳定的左侧或顶部导航菜单，以及明确的页面内容区。
- 列表、表格、筛选、分页、表单、详情、弹层等后台组件必须齐全。

## 组件规范

- 使用 Tailwind 自建后台 UI 规范：紧凑布局、清晰状态标签、可扫视的数据密度。
- 表格固定列宽或使用 `min-w`，长文本使用截断而不是撑破布局。
- 按钮和图标按钮必须有 hover/disabled/loading 状态。
- 图标统一使用 lucide-react，不手写 SVG 装饰。

## 交付约束

- 所有文件写入当前项目工作区，不写外部绝对路径。
- 页面完成后必须执行 `npm run build` 或启动 dev server 验证。
- 完成后使用中文总结项目结构、页面路径、预览地址和主要功能。

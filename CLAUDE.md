# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`zyd-fetch` 是一个基于 `axios` 和 `ali-oss` 封装的前端请求库，用 TypeScript 编写，通过 Rollup 打包为 ES + UMD 双格式发布。`axios` 和 `ali-oss` 是 `peerDependencies` 兼 `external`，不会被打进产物。

## 常用命令

```bash
yarn dev         # rollup 监听模式，边改边构建
yarn build       # rollup 打包，产出 dist/index.js (UMD) 与 dist/index-es.js (ES)
yarn type-check  # tsc --noEmit，仅做类型检查，不产出文件
```

改完代码后用 `yarn type-check` 验证类型、`yarn build` 验证打包。仓库没有测试框架。

## 架构

源码只有三个文件，入口 `src/index.ts` 只做 re-export，真实逻辑在另外两个：

### `src/request.ts` — 两个服务类

- **`ApiService`**：封装一个 axios 实例，构造时注入请求/响应拦截器。核心设计是**响应拦截器默认解包**——正常请求直接返回 `response.data`，只有当响应头带 `isBlob` 或 config 上设了 `returnFullResponse` 时才返回完整 `AxiosResponse`。业务错误码（`data.code !== successStatusCode`）和 HTTP 错误都会经 `statusMap` 转成中文文案并回调 `onError`。`get/post/put/delete` 的第三个参数 `hasErrorMessage` 控制是否触发全局错误提示。
- **`OSSService`**：`ali-oss` 客户端的薄封装。

`CustomRequestConfig` 在 `AxiosRequestConfig` 上扩展了 `hasErrorMessage` / `returnFullResponse` / `filename` 三个自定义字段，贯穿整个请求链路。

### `src/stream.ts` — AI 流式输出（SSE）

面向 AI 对话类端点的流式模块，通过 `ApiService.stream()` 暴露。关键设计点：

- **`SSEParser`**：增量式 SSE 解析器，跨 chunk 边界缓冲，处理 `\n`/`\r\n`/`\r` 三种行尾（含 `\r` 落在 chunk 分界的情况）、多行 `data:`、`event`/`id`/`retry` 字段和 `:` 注释行。
- **`StreamController`**：同一实例**同时支持两种消费方式**——`onMessage`/`onDone`/`onError` 回调，以及 `for await...of` 异步迭代。内部用队列 + resolver 数组做背压对接。
- **两种传输**，由 `options.transport` 选择，默认 `fetch`：
  - `runFetchStream`：fetch + ReadableStream，浏览器与 Node 18+ 通用，主路径。
  - `runAxiosStream`：Node 端用 `responseType: 'stream'`，浏览器端靠 `onDownloadProgress` 累积文本做增量 diff（axios 无法暴露 ReadableStream 的兜底方案）。
- **拦截器复用**：fetch 路径会通过 `applyRequestInterceptors` 把一个合成 config 过一遍 axios 实例的**请求**拦截器链（复用 token 注入等逻辑），但**响应拦截器不会执行**（其解包语义不适用于流式 chunk）。该函数读取 `instance.interceptors.request.handlers` 这一非公开属性，已做防御性兜底（取不到则 no-op）。
- SSE 数据默认按 `[DONE]` 哨兵判定结束（可通过 `doneSentinel` 配置/禁用），并默认对 `data` 做 `JSON.parse` 暴露到 `chunk.json`（解析失败静默）。

## 约定

- 代码注释使用中文。
- 面向 Node >=18.18 与现代浏览器；很多能力（原生 fetch、`TextDecoder`）依赖该运行时基线。

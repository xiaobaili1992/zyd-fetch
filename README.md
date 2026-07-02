# zyd-fetch

基于 `axios` 和 `ali-oss` 封装的企业级前端请求库。完全支持 **TypeScript**，提供统一的拦截器、错误处理、文件上传下载及 OSS 上传服务。

## ✨ 特性

- 🚀 **开箱即用**：封装了常见的 GET, POST, PUT, DELETE 方法。
- 🛡 **TypeScript 支持**：提供完整的类型定义 (`ApiServiceOptions`, `CustomRequestConfig` 等)。
- ⚙️ **全局配置**：支持自定义拦截器、超时时间、状态码映射。
- 🚨 **统一错误处理**：支持全局错误回调，也支持单次请求屏蔽错误提示。
- 📂 **文件处理**：内置文件上传 (`FormData`) 和下载 (`Blob`) 处理逻辑。
- ☁️ **OSS 支持**：集成阿里云 OSS 上传功能。
- 🌊 **流式输出**：内置 SSE 解析，适配 AI 流式响应，支持回调与 `for await...of` 两种消费方式。
- 🛑 **请求取消**：支持 `AbortController` 取消请求。

## 📦 安装

```bash
# 使用 yarn
yarn add zyd-fetch

# 使用 npm
npm install zyd-fetch
```

## 🚀 快速开始

### 1. 初始化 ApiService

建议在项目中创建一个 `api.ts` (或 `request.ts`) 文件进行统一配置。

```typescript
import { ApiService, type InternalAxiosRequestConfig, type AxiosResponse } from 'zyd-fetch';
// 假设你使用 Element Plus 进行消息提示
import { ElMessage } from 'element-plus';

// 1. 定义基础配置
const getBaseUrl = () => {
  return import.meta.env.MODE === 'development' 
    ? '/api' 
    : import.meta.env.VUE_APP_BASEURL;
};

// 2. 定义请求拦截器
const requestInterceptor = (config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
};

// 3. 定义响应拦截器
const responseInterceptor = (response: AxiosResponse) => {
  // 可以在这里处理通用的业务逻辑
  return response;
};

// 4. 定义全局错误处理
const onError = (message: string) => {
  ElMessage.error(message);
};

// 5. 实例化服务
export const api = new ApiService({
  baseURL: getBaseUrl(),
  timeout: 10000,
  successStatusCode: 200, // 业务成功状态码
  requestInterceptor,
  responseInterceptor,
  onError,
  // 可选：自定义 HTTP 状态码文案
  statusMap: {
    404: '资源不存在',
    500: '服务器开小差了'
  }
});
```

### 2. 基础请求示例

```typescript
import { api } from './api';

// 定义接口返回类型
interface User {
  id: number;
  name: string;
}

// GET 请求
export const getUserList = (params: { page: number }) => {
  return api.get<User[]>('/users', params);
};

// POST 请求
export const createUser = (data: Omit<User, 'id'>) => {
  return api.post<User>('/users', data);
};

// PUT 请求
export const updateUser = (data: User) => {
  return api.put<User>('/users', data);
};

// DELETE 请求
export const deleteUser = (id: number) => {
  return api.delete('/users', { id });
};
```

## 📖 进阶场景

### 场景一：自定义请求头与屏蔽全局错误

有些接口可能需要特殊的 Header，或者不希望触发全局的 `onError` 提示（例如由 UI 组件自己处理错误）。

```typescript
// 第三个参数 false 表示屏蔽全局错误提示
// 第四个参数用于合并自定义 Headers
export const secretAction = (data: any) => {
  return api.post(
    '/secret/action', 
    data, 
    false, 
    { 'X-Custom-Header': 'foobar' }
  );
};
```

### 场景二：获取完整响应 (Headers, Config 等)

默认情况下，`zyd-fetch` 直接返回 `response.data`。如果你需要获取 Headers（例如分页信息在 header 中），可以使用 `returnFullResponse` 配置。

```typescript
import type { AxiosResponse } from 'axios';

export const getListWithHeaders = async () => {
  // 使用 api.request 方法获得最大灵活性
  const response = await api.request<AxiosResponse>({
    method: 'get',
    url: '/list',
    returnFullResponse: true // 关键配置
  });
  
  console.log(response.headers['x-total-count']);
  return response.data;
};
```

### 场景三：文件上传

使用 `upload` 方法，库会自动处理 `multipart/form-data`。

```typescript
export const uploadAvatar = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  
  return api.upload('/upload/avatar', formData);
};
```

### 场景四：文件下载

使用 `download` 方法，库会自动处理 Blob 并触发浏览器下载。

```typescript
export const exportReport = (params: { date: string }) => {
  return api.download('/report/export', params, {
    filename: 'report.xlsx', // 指定下载文件名
    timeout: 60000 // 下载接口通常需要更长超时时间
  });
};
```

**高级下载场景**：如果文件名在响应头 `Content-Disposition` 中：

```typescript
export const exportDataAdvanced = async (params: any) => {
  // 1. 请求 Blob 数据，并获取完整响应
  const res = await api.request<any>({
    method: 'post',
    url: '/export',
    data: params,
    responseType: 'blob',
    returnFullResponse: true
  });

  const { data, headers } = res;
  
  // 2. 解析文件名
  const contentDisposition = headers['content-disposition'];
  let fileName = 'download.xlsx';
  if (contentDisposition) {
    const match = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?;?/);
    if (match && match[1]) {
      fileName = decodeURIComponent(match[1]);
    }
  }

  // 3. 手动触发下载
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};
```

### 场景五：请求取消

支持使用 `AbortController` 取消正在进行的请求。

```typescript
export const searchUsers = (query: string, signal: AbortSignal) => {
  return api.request({
    method: 'get',
    url: '/users/search',
    params: { q: query },
    signal // 传入 signal
  });
};

// 使用示例
const controller = new AbortController();
searchUsers('alice', controller.signal);
// 取消请求
controller.abort();
```

### 场景六：流式输出 (AI / SSE)

使用 `stream` 方法对接 AI 对话等 Server-Sent Events 端点。它默认使用原生 `fetch` + `ReadableStream`（浏览器与 Node 18+ 通用），内置 SSE 协议解析，自动处理 `data:` 行、`[DONE]` 结束标记，并默认对每个数据块做 `JSON.parse`。

返回的 controller 同时支持**回调**与 **`for await...of`** 两种消费方式。

```typescript
// 方式一：回调风格
export const chat = (messages: any[]) => {
  return api.stream('/v1/chat/completions', { messages, stream: true }, {
    onMessage: (chunk) => {
      // chunk.data 是原始文本；chunk.json 是解析后的对象（解析失败时为 undefined）
      const delta = chunk.json?.choices?.[0]?.delta?.content;
      if (delta) console.log(delta);
    },
    onDone: () => console.log('流结束'),
    onError: (err) => console.error(err),
  });
};

// 方式二：异步迭代风格
export const chatIterate = async (messages: any[]) => {
  const stream = api.stream('/v1/chat/completions', { messages, stream: true });
  for await (const chunk of stream) {
    const delta = chunk.json?.choices?.[0]?.delta?.content;
    if (delta) process.stdout.write(delta);
  }
};
```

`stream` 方法签名：`stream(url, data?, options?, config?)`。

- `data`：请求体，对象会自动 JSON 序列化（默认 `POST`）。
- `options`：流式配置（见下方 `StreamOptions`）。
- `config`：`{ method?, params?, headers? }`，用于覆盖方法、附加查询参数或自定义请求头。

**取消流**：通过 `options.signal` 传入 `AbortSignal` 即可。

```typescript
const controller = new AbortController();
api.stream('/v1/chat/completions', { messages }, {
  signal: controller.signal,
  onMessage: (chunk) => console.log(chunk.data),
});
controller.abort(); // 中止流
```

> **说明**：fetch 传输会复用实例的 `baseURL`、默认 headers，并跑一遍**请求拦截器**（因此 token 注入等逻辑同样生效），但**响应拦截器不会执行**（其解包语义不适用于流式数据块）。鉴权 header 也可通过 `config.headers` 单独传入。若需强制走 axios 传输，可设 `options.transport: 'axios'`。

## ☁️ 阿里云 OSS 上传

`zyd-fetch` 封装了 `ali-oss`，简化了上传流程。

### 初始化

```typescript
import { OSSService } from 'zyd-fetch';

export const ossApi = new OSSService({
  region: 'oss-cn-hangzhou',
  accessKeyId: 'your-access-key-id',
  accessKeySecret: 'your-access-key-secret',
  bucket: 'your-bucket-name'
});
```

### 上传文件

```typescript
export const uploadToOss = async (file: File) => {
  try {
    const dir = 'uploads';
    const timestamp = Date.now();
    // 生成唯一文件名
    const objectName = `${dir}/${timestamp}_${file.name}`;
    
    const result = await ossApi.upload(objectName, file);
    console.log('Upload success:', result);
    return result;
  } catch (error) {
    console.error('Upload failed:', error);
  }
};
```

## 🛠 API 参考

### ApiServiceOptions

| 属性 | 类型 | 默认值 | 说明 |
|Data | Type | Default | Description|
|---|---|---|---|
| `baseURL` | `string` | - | 基础 URL |
| `timeout` | `number` | `5000` | 超时时间 (ms) |
| `successStatusCode` | `number` | `200` | 业务成功状态码 |
| `headers` | `object` | `{}` | 默认请求头 |
| `requestInterceptor` | `function` | - | 请求拦截器 |
| `responseInterceptor` | `function` | - | 响应拦截器 |
| `onError` | `function` | - | 全局错误处理回调 |
| `statusMap` | `object` | `_statusMap` | HTTP 状态码错误文案映射 |

### CustomRequestConfig (扩展 AxiosRequestConfig)

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hasErrorMessage` | `boolean` | `true` | 是否显示全局错误提示 |
| `returnFullResponse` | `boolean` | `false` | 是否返回完整响应对象 (包含 headers 等) |
| `filename` | `string` | - | 下载文件时的默认文件名 |

### StreamOptions (流式请求配置)

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `onMessage` | `(chunk: StreamChunk) => void` | - | 每解析出一个数据块时触发 |
| `onDone` | `() => void` | - | 流正常结束时触发一次 |
| `onError` | `(error: any) => void` | - | 发生传输/解析错误或被中止时触发 |
| `parseJSON` | `boolean` | `true` | 是否对每个 `data` 负载做 `JSON.parse`（结果放入 `chunk.json`，失败静默） |
| `doneSentinel` | `string \| null` | `'[DONE]'` | `data` 中标记流结束的哨兵值，设为 `null` 可禁用 |
| `transport` | `'fetch' \| 'axios'` | `'fetch'` | 底层传输方式，可用时默认 fetch |
| `signal` | `AbortSignal` | - | 用于取消流 |

### StreamChunk (流式数据块)

| 属性 | 类型 | 说明 |
|---|---|---|
| `event` | `string` | SSE `event:` 字段，默认 `'message'` |
| `data` | `string` | 原始 `data:` 负载 |
| `id` | `string?` | SSE `id:` 字段（若存在） |
| `json` | `T?` | 当 `parseJSON` 启用且解析成功时的解析结果 |

---

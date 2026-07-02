import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

/**
 * 单条已解析的 Server-Sent Event。
 * 对应 SSE 传输格式：https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export interface SSEEvent {
  /** `event:` 字段，默认为 'message'。 */
  event: string;
  /** 拼接后的 `data:` 字段内容。 */
  data: string;
  /** `id:` 字段（若存在）。 */
  id?: string;
  /** `retry:` 字段（重连时间，单位毫秒，若存在）。 */
  retry?: number;
}

/**
 * 投递给消费方的已解析流式数据块。
 * `data` 为原始 `data:` 负载；当启用 `parseJSON` 且解析成功时，
 * 解析结果通过 `json` 暴露。
 */
export interface StreamChunk<T = any> {
  event: string;
  data: string;
  id?: string;
  json?: T;
}

export interface StreamOptions<T = any> {
  /** 每解析出一个数据块时调用。 */
  onMessage?: (chunk: StreamChunk<T>) => void;
  /** 流正常结束时调用一次。 */
  onDone?: () => void;
  /** 发生任何传输/解析错误或被中止时调用。 */
  onError?: (error: any) => void;
  /**
   * 为 true 时（默认），每个 `data` 负载都会经过 JSON.parse，
   * 结果通过 `chunk.json` 暴露。解析失败会被静默忽略（json 保持 undefined）。
   */
  parseJSON?: boolean;
  /**
   * `data` 字段中标记流结束的哨兵值（OpenAI 风格）。
   * 默认为 '[DONE]'。设为 null 可禁用哨兵处理。
   */
  doneSentinel?: string | null;
  /** 强制指定传输方式而非自动探测。默认在可用时使用 'fetch'。 */
  transport?: 'fetch' | 'axios';
  /** 用于取消流的 AbortSignal。 */
  signal?: AbortSignal;
}

/**
 * Server-Sent Events 传输格式的增量解析器。
 *
 * 通过 `push` 把陆续到达的解码文本块喂进来；它会跨块边界缓冲不完整的
 * 行/事件，并返回已完整的事件。支持 `\n`、`\r\n`、`\r` 三种行终止符、
 * 多行 `data:` 字段、注释行（以 `:` 开头），以及 `event`/`id`/`retry` 字段。
 */
export class SSEParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastId: string | undefined;
  private retry: number | undefined;

  /** 喂入一块解码后的文本；返回本次输入所补齐的完整事件。 */
  push(text: string): SSEEvent[] {
    this.buffer += text;
    const events: SSEEvent[] = [];

    // 归一化行尾，以便统一按 \n 切分。
    // 只处理到最后一个换行符为止；剩余的尾部继续缓冲。
    let newlineIndex: number;
    // 仅在已完整接收的部分内替换 CRLF/CR 为 LF。
    while ((newlineIndex = this.indexOfLineBreak(this.buffer)) !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex.valueOf());
      // 跳过换行符（可能是 1 或 2 个字符）。
      const breakLen = this.buffer[newlineIndex] === '\r' && this.buffer[newlineIndex + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(newlineIndex + breakLen);

      const line = rawLine;
      if (line === '') {
        // 空行触发已累积事件的分发。
        const evt = this.buildEvent();
        if (evt) events.push(evt);
        continue;
      }
      this.consumeLine(line);
    }
    return events;
  }

  /** 冲刷尾部那个未以空行结尾的事件。 */
  flush(): SSEEvent[] {
    const events: SSEEvent[] = [];
    // 末尾没有换行的行属于不完整 SSE，但很多服务端会省略最后的空行——
    // 尽力把已有内容构建出来。
    if (this.buffer.length) {
      this.consumeLine(this.buffer);
      this.buffer = '';
    }
    const evt = this.buildEvent();
    if (evt) events.push(evt);
    return events;
  }

  private indexOfLineBreak(s: string): number {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\n') return i;
      if (c === '\r') {
        // 仅当其后已有字符（即它不在末尾）时才视为换行，
        // 否则末尾的 '\r' 可能是被拆到两个块里的 '\r\n' 的前半部分。
        if (i + 1 < s.length) return i;
        return -1; // 等待更多数据
      }
    }
    return -1;
  }

  private consumeLine(line: string) {
    if (line.startsWith(':')) return; // 注释/心跳
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      // 按规范，冒号后紧跟的单个空格需去掉。
      if (value.startsWith(' ')) value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        this.lastId = value;
        break;
      case 'retry': {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n)) this.retry = n;
        break;
      }
      default:
        break; // 未知字段忽略
    }
  }

  private buildEvent(): SSEEvent | null {
    if (this.dataLines.length === 0 && this.eventType === '') return null;
    const evt: SSEEvent = {
      event: this.eventType || 'message',
      data: this.dataLines.join('\n'),
      id: this.lastId,
      retry: this.retry,
    };
    // 重置每个事件的状态；按规范 id/retry 会跨事件保留，但这里只按事件暴露。
    this.dataLines = [];
    this.eventType = '';
    this.retry = undefined;
    return evt;
  }
}

/**
 * 把基于推送的事件投递桥接到回调与异步迭代两种消费方式。
 *
 * 同一个 controller 实例可以两种方式消费：
 *  - 通过 options 中传入的 `onMessage`/`onDone`/`onError` 回调，以及/或者
 *  - 通过 `for await (const chunk of controller)`——它是异步可迭代对象。
 */
export class StreamController<T = any> implements AsyncIterable<StreamChunk<T>> {
  private queue: StreamChunk<T>[] = [];
  private resolvers: Array<(r: IteratorResult<StreamChunk<T>>) => void> = [];
  private ended = false;
  private error: any = null;

  constructor(private options: StreamOptions<T> = {}) {}

  /** 向回调以及任一挂起的迭代消费方发出一个数据块。 */
  emit(chunk: StreamChunk<T>) {
    if (this.ended) return;
    this.options.onMessage?.(chunk);
    const resolve = this.resolvers.shift();
    if (resolve) {
      resolve({ value: chunk, done: false });
    } else {
      this.queue.push(chunk);
    }
  }

  /** 标记正常结束。 */
  close() {
    if (this.ended) return;
    this.ended = true;
    this.options.onDone?.();
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as any, done: true });
    }
  }

  /** 标记发生错误；使挂起的迭代器抛出。 */
  fail(err: any) {
    if (this.ended) return;
    this.error = err;
    this.ended = true;
    this.options.onError?.(err);
    // 唤醒挂起的消费方；迭代器的 next() 会抛出。
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamChunk<T>> {
    return {
      next: (): Promise<IteratorResult<StreamChunk<T>>> => {
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.error) return Promise.reject(this.error);
        if (this.ended) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}

/** 把一条原始 SSE 事件转成 StreamChunk，应用 JSON 解析 / 结束哨兵逻辑。 */
function toChunk<T>(evt: SSEEvent, options: StreamOptions<T>): { chunk?: StreamChunk<T>; done: boolean } {
  const sentinel = options.doneSentinel === undefined ? '[DONE]' : options.doneSentinel;
  if (sentinel !== null && evt.data === sentinel) {
    return { done: true };
  }
  const chunk: StreamChunk<T> = { event: evt.event, data: evt.data, id: evt.id };
  if (options.parseJSON !== false && evt.data) {
    try {
      chunk.json = JSON.parse(evt.data) as T;
    } catch {
      // 解析失败时 json 保持 undefined
    }
  }
  return { chunk, done: false };
}

/** 用给定的解码文本流所产生的事件驱动 controller。 */
function feedParser<T>(
  parser: SSEParser,
  controller: StreamController<T>,
  options: StreamOptions<T>,
  events: SSEEvent[],
): boolean {
  for (const evt of events) {
    const { chunk, done } = toChunk(evt, options);
    if (done) return true;
    if (chunk) controller.emit(chunk);
  }
  return false;
}

/** fetch + ReadableStream 传输。适用于现代浏览器与 Node 18+。 */
async function runFetchStream<T>(
  url: string,
  init: RequestInit,
  controller: StreamController<T>,
  options: StreamOptions<T>,
) {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`Stream request failed with status ${res.status}`);
    }
    if (!res.body) {
      throw new Error('Response body is not readable (no ReadableStream)');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new SSEParser();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const finished = feedParser(parser, controller, options, parser.push(text));
      if (finished) {
        await reader.cancel().catch(() => {});
        controller.close();
        return;
      }
    }
    // 冲刷尾部残留的事件。
    feedParser(parser, controller, options, parser.flush());
    controller.close();
  } catch (err) {
    controller.fail(err);
  }
}

/** axios 传输。服务端用 Node 流，浏览器端用 onDownloadProgress。 */
async function runAxiosStream<T>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  controller: StreamController<T>,
  options: StreamOptions<T>,
) {
  const parser = new SSEParser();
  const isNode = typeof window === 'undefined';

  try {
    if (isNode) {
      // Node：responseType 'stream' 会返回一个可迭代的 Readable。
      const res = await instance.request({ ...config, responseType: 'stream' });
      const nodeStream = res.data as NodeJS.ReadableStream & AsyncIterable<Buffer>;
      const decoder = new TextDecoder('utf-8');
      for await (const value of nodeStream) {
        const text = decoder.decode(value as any, { stream: true });
        const finished = feedParser(parser, controller, options, parser.push(text));
        if (finished) {
          (nodeStream as any).destroy?.();
          controller.close();
          return;
        }
      }
      feedParser(parser, controller, options, parser.flush());
      controller.close();
    } else {
      // 浏览器：axios 无法暴露 ReadableStream，只能对 onDownloadProgress
      // 累积的 responseText 做增量 diff。
      let lastLength = 0;
      let finished = false;
      await instance.request({
        ...config,
        responseType: 'text',
        onDownloadProgress: (progressEvent: any) => {
          if (finished) return;
          const xhr = progressEvent.event?.target as XMLHttpRequest | undefined;
          const responseText: string = xhr?.responseText ?? '';
          const delta = responseText.slice(lastLength);
          lastLength = responseText.length;
          if (!delta) return;
          if (feedParser(parser, controller, options, parser.push(delta))) {
            finished = true;
          }
        },
      });
      if (!finished) {
        feedParser(parser, controller, options, parser.flush());
      }
      controller.close();
    }
  } catch (err) {
    if (axios.isCancel?.(err)) {
      controller.close();
    } else {
      controller.fail(err);
    }
  }
}

export interface StreamTransportConfig<T> {
  /** 绝对或相对 URL（相对路径会基于 axios 实例的 baseURL 解析）。 */
  url: string;
  /** HTTP 方法，默认为 POST（AI 对话端点的常见做法）。 */
  method?: string;
  /** 请求体；对于 fetch 传输，对象会被 JSON 序列化。 */
  data?: any;
  /** 查询参数。 */
  params?: Record<string, any>;
  /** 覆盖在实例默认值之上的额外 headers。 */
  headers?: Record<string, any>;
  /** 用于复用 baseURL/headers（以及 axios 传输）的 axios 实例。 */
  instance: AxiosInstance;
  options: StreamOptions<T>;
}

/**
 * 发起一个流式请求并返回 StreamController。
 *
 * 返回的 controller 既是异步可迭代对象，又会触发 `options` 中的回调。
 * 底层传输在后台运行；controller 随事件到达而 resolve/reject。
 */
export function createStream<T = any>(cfg: StreamTransportConfig<T>): StreamController<T> {
  const { url, method = 'POST', data, params, headers, instance, options } = cfg;
  const controller = new StreamController<T>(options);

  const useFetch = options.transport !== 'axios' && typeof fetch === 'function';

  if (useFetch) {
    // 以内部 async 方式运行 fetch 路径，以便在发起前 await 请求拦截器链。
    // controller 仍然同步返回；事件在请求 resolve 后才开始流动。
    (async () => {
      try {
        const baseURL = instance.defaults.baseURL || '';
        const mergedHeaders: Record<string, any> = {
          Accept: 'text/event-stream',
          ...flattenHeaders(instance.defaults.headers),
          ...headers,
        };
        const hasBody = data !== undefined && method.toUpperCase() !== 'GET';
        if (hasBody && !hasHeader(mergedHeaders, 'content-type')) {
          mergedHeaders['Content-Type'] = 'application/json';
        }

        // 把一个合成的 axios 风格 config 喂进实例的请求拦截器，
        // 让 token 注入 / header 逻辑对 fetch 同样生效。
        const resolved = await applyRequestInterceptors(instance, {
          url,
          method: method.toLowerCase(),
          baseURL,
          headers: mergedHeaders,
          params: params || {},
          data,
        });

        const finalHeaders = flattenHeaders(resolved.headers);
        const finalUrl = resolveUrl(resolved.baseURL || baseURL, resolved.url ?? url, resolved.params);
        const finalData = resolved.data !== undefined ? resolved.data : data;
        const finalHasBody = finalData !== undefined && (resolved.method || method).toUpperCase() !== 'GET';

        const init: RequestInit = {
          method: (resolved.method || method).toUpperCase(),
          headers: finalHeaders,
          body: finalHasBody ? (typeof finalData === 'string' ? finalData : JSON.stringify(finalData)) : undefined,
          signal: options.signal,
        };
        await runFetchStream(finalUrl, init, controller, options);
      } catch (err) {
        controller.fail(err);
      }
    })();
  } else {
    runAxiosStream(instance, { url, method, data, params, headers, signal: options.signal }, controller, options);
  }

  return controller;
}

/**
 * 把一个合成的 config 过一遍 axios 实例的请求拦截器链。
 * 拦截器按注册的反向顺序执行，与 axios 自身行为一致。
 * 返回（可能被修改过的）config。任一处理器出错时回退为输入值。
 */
async function applyRequestInterceptors(instance: AxiosInstance, config: any): Promise<any> {
  const manager: any = (instance.interceptors as any)?.request;
  const handlers: any[] = manager?.handlers || [];
  let current = config;
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (!h || typeof h.fulfilled !== 'function') continue;
    current = await h.fulfilled(current);
  }
  return current;
}

/** 基于 base 解析 URL 并附加查询参数。 */
function resolveUrl(base: string, url: string, params?: Record<string, any>): string {
  let full = /^https?:\/\//i.test(url) ? url : joinURL(base, url);
  if (params && Object.keys(params).length) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    if (qs) full += (full.includes('?') ? '&' : '?') + qs;
  }
  return full;
}

function joinURL(base: string, path: string): string {
  if (!base) return path;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

/** 把 axios 分层的 header 默认值（common + 各方法）扁平化为一个平铺对象。 */
function flattenHeaders(headers: any): Record<string, any> {
  if (!headers) return {};
  const out: Record<string, any> = {};
  const merge = (h: any) => {
    if (!h || typeof h !== 'object') return;
    // AxiosHeaders 提供 toJSON()，可得到一个干净的 header 映射。
    const src = typeof h.toJSON === 'function' ? h.toJSON() : h;
    for (const k of Object.keys(src)) {
      if (typeof src[k] !== 'object' && typeof src[k] !== 'function') out[k] = src[k];
    }
  };
  merge(headers.common);
  merge(headers);
  return out;
}

function hasHeader(headers: Record<string, any>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import OSS from 'ali-oss';
import { createStream, StreamController, StreamOptions } from './stream';

/**
 * HTTP 状态码映射
 */
const _statusMap: Record<number, string> = {
  400: '请求错误',
  401: '未授权，请登录',
  403: '拒绝访问',
  404: '请求错误,未找到该资源',
  405: '请求方法未允许',
  408: '请求超时',
  500: '服务器端出错',
  501: '网络未实现',
  502: '网络错误',
  503: '服务不可用',
  504: '网络超时',
  505: 'http版本不支持该请求',
  506: 'http代理错误',
};

// 扩展 AxiosRequestConfig 以包含自定义属性
interface CustomRequestConfig extends AxiosRequestConfig {
  hasErrorMessage?: boolean;
  returnFullResponse?: boolean;
  filename?: string; // 用于文件下载
}

interface CustomInternalAxiosRequestConfig extends InternalAxiosRequestConfig {
    hasErrorMessage?: boolean;
    returnFullResponse?: boolean;
}

interface ApiServiceOptions {
  baseURL: string;
  timeout?: number;
  successStatusCode?: number;
  headers?: Record<string, any>;
  requestInterceptor?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
  responseInterceptor?: (response: AxiosResponse) => any;
  onError?: (msg: string) => void;
  statusMap?: Record<number, string>;
}

/**
 * ApiService 类
 * 封装 axios，统一管理请求、错误处理与拦截器。
 */
class ApiService {
  private service: AxiosInstance;
  private statusMap: Record<number, string>;

  constructor({
    baseURL,
    timeout = 5000,
    successStatusCode = 200,
    headers = {},
    requestInterceptor,
    responseInterceptor,
    onError,
    statusMap,
  }: ApiServiceOptions) {
    this.statusMap = statusMap || _statusMap;

    this.service = axios.create({
      baseURL,
      timeout,
      headers,
    });

    // 请求拦截器
    this.service.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (requestInterceptor) {
          // 若拦截器修改了 config 类型，可能需要类型断言
          return requestInterceptor(config);
        }
        return config;
      },
      (error: any) => {
        console.error('Request Error:', error);
        return Promise.reject(error);
      },
    );

    // 响应拦截器
    this.service.interceptors.response.use(
      (response: AxiosResponse) => {
        if (responseInterceptor) {
          return responseInterceptor(response);
        }
        
        const { headers, config, data } = response || {};
        const { isBlob } = headers || {};
        const customConfig = config as CustomInternalAxiosRequestConfig;
        const { hasErrorMessage } = customConfig || {};
        const { code, msg } = data || {};
        
        // 业务逻辑错误校验
        if (hasErrorMessage && code !== successStatusCode) {
          onError && onError(msg);
        }
        
        // 若为 blob 或调用方显式要求，则返回完整响应
        if (isBlob || customConfig.returnFullResponse) {
          return response;
        }
        
        return response.data;
      },
      (error: any) => {
        const config = (error.config || {}) as CustomInternalAxiosRequestConfig;
        // 请求被取消时跳过错误处理
        if (axios.isCancel(error)) {
          return Promise.reject(error);
        }

        if (config?.hasErrorMessage !== false) {
          // 默认错误信息处理
          if (error?.response) {
            const { status } = error.response;
            if (status && this.statusMap[status]) {
              error.message = this.statusMap[status];
            } else {
              error.message = `连接错误${status}`;
            }
          } else {
            error.message = '连接服务器失败';
            if (JSON.stringify(error).includes('timeout')) {
              error.message = '服务器响应超时，请刷新当前页';
            }
          }

          if (onError) onError(error.message);
        }

        return Promise.reject(error);
      },
    );
  }

  /**
   * 通用请求方法
   * @param config - Axios 请求配置
   * @returns 响应数据
   */
  async request<T = any>(config: CustomRequestConfig): Promise<T> {
    try {
      // 响应拦截器可能直接返回 data，因此这里需要类型转换
      const response = await this.service.request(config);
      return response as unknown as T;
    } catch (error) {
      // 同时允许调用方处理该错误
      throw error;
    }
  }

  async get<T = any>(url: string, params?: any, hasErrorMessage = true, headers = {}): Promise<T> {
    return this.request<T>({ method: 'get', url, params, hasErrorMessage, headers });
  }

  async post<T = any>(url: string, data?: any, hasErrorMessage = true, headers = {}): Promise<T> {
    return this.request<T>({ method: 'post', url, data, hasErrorMessage, headers });
  }

  async put<T = any>(url: string, data?: any, hasErrorMessage = true, headers = {}): Promise<T> {
    return this.request<T>({ method: 'put', url, data, hasErrorMessage, headers });
  }

  async delete<T = any>(url: string, params?: any, hasErrorMessage = true, headers = {}): Promise<T> {
    return this.request<T>({ method: 'delete', url, params, hasErrorMessage, headers });
  }

  /**
   * 上传文件（multipart/form-data）
   */
  async upload<T = any>(url: string, formData: FormData, config: CustomRequestConfig = {}): Promise<T> {
    return this.request<T>({
      method: 'post',
      url,
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data', ...config.headers },
      ...config,
    });
  }

  /**
   * 下载文件
   */
  async download(url: string, params?: any, config: CustomRequestConfig = {}): Promise<void> {
    if (typeof window === 'undefined') {
      console.warn('Download is not supported in non-browser environment');
      return;
    }
    try {
      const response = await this.service.get(url, {
        params,
        responseType: 'blob',
        ...config,
      });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', config.filename || 'file');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl); // 清理
    } catch (error) {
      console.error('Download Error:', error);
      throw error;
    }
  }

  /**
   * 面向 AI / Server-Sent Events 端点的流式请求。
   *
   * 复用当前实例的 baseURL 与默认 headers。返回的 controller 既是异步可迭代对象，
   * 又会触发 `options` 中的回调，两种风格都能用：
   *
   * ```ts
   * // 回调风格
   * api.stream('/chat', { messages }, {
   *   onMessage: (chunk) => console.log(chunk.json ?? chunk.data),
   *   onDone: () => console.log('finished'),
   *   onError: (e) => console.error(e),
   * });
   *
   * // 异步迭代风格
   * const stream = api.stream('/chat', { messages });
   * for await (const chunk of stream) {
   *   console.log(chunk.json ?? chunk.data);
   * }
   * ```
   *
   * 说明：fetch 传输（options.transport 默认为 'fetch'）会跑请求拦截器以复用
   * token 注入等逻辑，但响应拦截器不会执行；baseURL 与默认 headers 同样会复用。
   * 也可通过 `config.headers` 单独传入鉴权 header。
   */
  stream<T = any>(
    url: string,
    data?: any,
    options: StreamOptions<T> = {},
    config: { method?: string; params?: Record<string, any>; headers?: Record<string, any> } = {},
  ): StreamController<T> {
    return createStream<T>({
      url,
      method: config.method || 'POST',
      data,
      params: config.params,
      headers: config.headers,
      instance: this.service,
      options,
    });
  }
}

interface OSSServiceOptions {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
}

/**
 * OSS 服务类
 * ali-oss 客户端封装
 */
class OSSService {
  private client: OSS;

  constructor({ region, accessKeyId, accessKeySecret, bucket }: OSSServiceOptions) {
    this.client = new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket,
    });
  }

  /**
   * 上传文件到 OSS
   * @param filePath - bucket 内的路径
   * @param file - 文件内容
   */
  async upload(filePath: string, file: any): Promise<OSS.PutObjectResult> {
    try {
      const result = await this.client.put(filePath, file);
      return result;
    } catch (error) {
      console.error('OSS Upload Error:', error);
      throw error;
    }
  }
}

export { ApiService, OSSService };
export type { CustomRequestConfig, ApiServiceOptions, OSSServiceOptions };
export { createStream, StreamController, SSEParser } from './stream';
export type { StreamOptions, StreamChunk, SSEEvent } from './stream';

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import OSS from 'ali-oss';

/**
 * HTTP Status Code Mapping
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

// Extend AxiosRequestConfig to include custom properties
interface CustomRequestConfig extends AxiosRequestConfig {
  hasErrorMessage?: boolean;
  returnFullResponse?: boolean;
  filename?: string; // for download
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
 * ApiService Class
 * Encapsulates axios for unified request management, error handling, and interceptors.
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

    // Request Interceptor
    this.service.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (requestInterceptor) {
          // Type assertion might be needed if interceptor modifies config type
          return requestInterceptor(config);
        }
        return config;
      },
      (error: any) => {
        console.error('Request Error:', error);
        return Promise.reject(error);
      },
    );

    // Response Interceptor
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
        
        // Business logic error check
        if (hasErrorMessage && code !== successStatusCode) {
          onError && onError(msg);
        }
        
        // Return full response if it's a blob or specifically requested
        if (isBlob || customConfig.returnFullResponse) {
          return response;
        }
        
        return response.data;
      },
      (error: any) => {
        const config = (error.config || {}) as CustomInternalAxiosRequestConfig;
        // Skip error handling if request was canceled
        if (axios.isCancel(error)) {
          return Promise.reject(error);
        }

        if (config?.hasErrorMessage !== false) {
          // Default error message handling
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
   * Generic Request Method
   * @param config - Axios request config
   * @returns Response data
   */
  async request<T = any>(config: CustomRequestConfig): Promise<T> {
    try {
      // We might need to cast the result because our response interceptor can return data directly
      const response = await this.service.request(config);
      return response as unknown as T;
    } catch (error) {
      // Allow caller to handle error as well
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
   * Upload file (multipart/form-data)
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
   * Download file
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
      window.URL.revokeObjectURL(blobUrl); // Clean up
    } catch (error) {
      console.error('Download Error:', error);
      throw error;
    }
  }
}

interface OSSServiceOptions {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
}

/**
 * OSS Service Class
 * Wrapper for ali-oss client
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
   * Upload file to OSS
   * @param filePath - Path in bucket
   * @param file - File content
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

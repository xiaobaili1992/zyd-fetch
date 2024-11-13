import axios from 'axios';
import OSS from 'ali-oss';

const _statusMap = {
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

class ApiService {
  constructor({
    baseURL,
    timeout = 5000,
    headers = {},
    requestInterceptor,
    responseInterceptor,
    onError,
    statusMap,
  }) {
    this.statusMap = statusMap || _statusMap;

    this.service = axios.create({
      baseURL,
      timeout,
      headers,
    });

    this.service.interceptors.request.use(
      (config) => {
        if (requestInterceptor) {
          config = requestInterceptor(config);
        }
        return config;
      },
      (error) => {
        console.error('Request Error:', error);
        return Promise.reject(error);
      },
    );

    this.service.interceptors.response.use(
      (response) => {
        if (responseInterceptor) {
          return responseInterceptor(response);
        }
        return response.data;
      },
      (error) => {
        const config = error.config || {};
        if (config?.hasErrorMessage !== false) {
          // 默认显示错误信息，除非 message 设置为 false
          if (error?.response) {
            const { status } = error?.response || {};
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

  async request(config) {
    try {
      const response = await this.service.request(config);
      return response;
    } catch (error) {
      console.error('Request Error:', error);
      throw error;
    }
  }

  async get(url, params, hasErrorMessage = true, headers = {}) {
    return this.request({ method: 'get', url, params, hasErrorMessage, headers });
  }

  async post(url, data, hasErrorMessage = true, headers = {}) {
    return this.request({ method: 'post', url, data, hasErrorMessage, headers });
  }

  async put(url, data, hasErrorMessage = true, headers = {}) {
    return this.request({ method: 'put', url, data, hasErrorMessage, headers });
  }

  async delete(url, params, hasErrorMessage = true, headers = {}) {
    return this.request({ method: 'delete', url, params, hasErrorMessage, headers });
  }

  async upload(url, formData, config = {}) {
    return this.request({
      method: 'post',
      url,
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data', ...config.headers },
      ...config,
    });
  }

  async download(url, params, config = {}) {
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
    } catch (error) {
      console.error('Download Error:', error);
      throw error;
    }
  }
}

class OSSService {
  constructor({ region, accessKeyId, accessKeySecret, bucket }) {
    this.client = new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket,
    });
  }

  async upload(filePath, file) {
    try {
      const result = await this.client.put(filePath, file);
      return result;
    } catch (error) {
      console.error('OSS Upload Error:', error);
      alert('OSS Upload Failed');
      throw error;
    }
  }
}

export { ApiService, OSSService };

### zyd-fetch
### 说明
1. 基于axios封装的企业级请求库，支持拦截器、请求取消、全局错误处理等功能。
2. 支持OSS上传、自定义文件上传upload、文件下载download。
3. 支持自定义超时时间、自定义请求头、自定义请求拦截器、响应拦截器、错误处理、自定义状态文案、请求参数、响应数据等功能。
4. 支持get、post、put、delete等请求方法。

### 安装
```
yarn add zyd-fetch
```
### 新建一个api.js文件
```
import { ApiService, OSSService } from 'zyd-fetch';
import { ElMessage } from 'element-plus';
import { getToken } from '@/utils/auth';

export const getBaseUrl = () => {
  switch (import.meta.env.MODE) {
    case 'development':
      return `http://${location.host}`; // 开发环境
    default:
      return import.meta.env.VUE_APP_BASEURL; // 生产环境
  }
};

const onError = (message) => ElMessage.error(message);

const requestInterceptor = (config) => {
  const token = getToken();
  if (!token) {
    return config;
  }
  return {
    ...config,
    headers: {
      ...config.headers,
      'Content-Type': 'application/json;charset=UTF-8',
      Token: token,
      Authorization: `Bearer ${token}`,
    },
  };
};

const api = new ApiService({
  baseURL: getBaseUrl(),
  timeout: 30000,
  requestInterceptor,
  onError,
});

const ossApi = new OSSService({
  region: 'xxxx',
  accessKeyId: 'xxx',
  accessKeySecret: 'xxx',
  bucket: 'xxx',
});

export { api, ossApi };

```
### 如何使用
```
import { api } from '@/api';

export const getList = (params) => api.get('/api/getList', params);
export const getData = (data) => api.post('/api/getData', data);
export const deleteData = (params) => api.delete('/api/delete', params);
export const putData = (data) => api.put('/api/put', data);
export const uploadFile = (params) => api.upload('/api/uploadFile', formData);
export const downloadFile = (data) => api.download('/api/downloadFile', params);
```

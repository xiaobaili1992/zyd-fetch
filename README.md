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
  // 请求拦截器，自定义处理逻辑
  const token = getToken();
  if (!token) {
    return config;
  }
  return {
    ...config,
    responseType: config.headers.isBlob ? 'blob' : 'json', // 如果要下载文件，需要设置responseType为blob; 不添加的话，下载文件是损坏的
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Token: token,
      Authorization: `Bearer ${token}`,
      ...config.headers,
    },
  };
};

const responseInterceptor = (response) => {
  // 响应拦截器，自定义处理逻辑
  return response;
};

const api = new ApiService({
  baseURL: getBaseUrl(),
  timeout: 30000,
  successStatusCode: '00000', // 成功状态码，默认200，根据公司业务来定义
  requestInterceptor,
  responseInterceptor,
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

// 第三个参数默认为true，表示使用全局的错误提示框，提示接口返回的错误信息，false表示不使用全局的错误提示框，使用自定义的错误处理函数;
export const getData = (data) => api.post('/api/getData', data, false); 

// 第四个参数表示请求头，不传默认为application/json;charset=UTF-8;
export const getData = (data) => api.post('/api/getData', data, false, { 'Content-Type': 'application/json;charset=UTF-8' }); 
export const deleteData = (params) => api.delete('/api/delete', params);
export const putData = (data) => api.put('/api/put', data);
export const uploadFile = (params) => api.upload('/api/uploadFile', formData);
export const downloadFile = (data) => api.download('/api/downloadFile', params);

// 如果要返回全量的数据，使用isBlob: true, 有一种场景需要拿到返回的headers数据，比如导出文件的文件名在headers['content-disposition']中;
export const exportData = (data) => api.post('/edge_api/route/export', data, false, { isBlob: true }); 
// 使用阿里云oss上传
const uploadFile = async (file: File): Promise<UploadResponse> => {
  try {
    const dir = 'edge';
    const timestamp = new Date().getTime();
    const objectName = `${dir}/${timestamp}_${file.name}`;
    const uploader = await ossApi.upload(objectName, file);
    ...
  } catch (e) {
    console.log("e", e)
  }
};
```
### 获取接口返回的headers数据，使用headers中的content-disposition文件名下载文件
```
const downloadFile async () => {
  const params = {
    ...
  };
  const res = await exportData(params);
  const { data, headers } = res || {};
  const blob = new Blob([data], { type: 'application/x-tar; charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const contentDisposition = headers['content-disposition'];
  const fileName = decodeURIComponent(contentDisposition.split('filename*=')[1]?.replace(/"/g, '')?.replace(/UTF-8''/g, ''));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
```

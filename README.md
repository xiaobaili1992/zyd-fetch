### 本地开发公共库
```
yarn global add yalc
```
#### 在公共库中使用
```
yarn build // 公共库打包
yalc publish
```
### 在实际项目中使用
```
yalc add <package name>
```

### 或者在公共库中使用
```
yarn link
```
### 在实际项目中使用
```
yarn link <package name>
```
### npm发布、先npm注册登录，可以直接去官网注册，也可以使用命令
```
npm adduser
```
### 注册完之后登录
```
npm login
```
### 在登录之前记得先将源切换成npm官方源，可以使用nrm工具快速切换
```
yarn global add nrm
nrm ls
nrm use npm
```
### 或者在项目根目录新建.npmrc文件，内容如下
```
registry=https://registry.npmjs.org
```
### 当然也可以直接通过命令设置
```
npm config set registry https://registry.npmjs.org
```
### 发布
```
npm publish
```
### 发布beta包
```
npm publish --tag beta
```
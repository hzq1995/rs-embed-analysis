# React Geo Intelligence Workbench

一个 React + Leaflet 前端工作台，用来调用 FastAPI 后端并展示 Earth Engine 返回的图层。默认底图为天地图影像 WMTS。

## 使用方式

1. 创建 `.env`：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

2. 安装并启动：

```powershell
npm install
npm run dev
```

3. 浏览器打开 Vite 输出的地址。

## 目录

- `src/App.jsx`: 平台工作台页面
- `src/api.js`: 后端接口封装
- `src/hooks/useMapScene.js`: Leaflet 地图场景封装

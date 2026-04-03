# 河道水位识别 Demo

一个面向众包上传单张图片场景的最小可运行 Demo。用户上传桥墩水尺照片后，页面会通过本地 Node 服务代理调用豆包 `doubao-seed-2-0-mini-260215` 视觉模型，要求模型返回结构化 JSON，包括：

- `depth_cm`: 估计淹没深度
- `uncertainty_cm`: 不确定性
- `confidence`: 置信度
- `status`: 正常输出 / 人工复核 / 未检测到水尺

## 目录结构

- `/server.js`: 本地静态服务 + API 代理
- `/api/config.js`: Vercel 配置接口
- `/api/analyze.js`: Vercel 识别接口
- `/lib/ark.js`: 本地服务与 Vercel 函数共用的豆包调用逻辑
- `/public/index.html`: Demo 页面
- `/public/app.js`: 上传、预览、请求、结果渲染
- `/public/prompt-template.js`: Prompt 模板与默认模型
- `/public/examples`: 示例图片

## 运行方式

1. 进入目录：

```bash
cd "/Users/zixu/Documents/app project/水位提取"
```

2. 可选：在终端设置服务端 API Key

```bash
export ARK_API_KEY="你的豆包 API Key"
```

3. 启动服务

```bash
npm start
```

4. 浏览器打开

```text
http://localhost:3000
```

如果未设置 `ARK_API_KEY`，也可以直接在页面里填写 Key。

## Vercel 部署说明

如果部署到 Vercel：

1. 在项目环境变量中设置 `ARK_API_KEY`
2. 直接使用仓库根目录部署
3. 示例图片来自 `/public/examples`，不依赖自定义文件路由

当前仓库已经补齐了 Vercel 的 `api/config.js` 和 `api/analyze.js`，页面在 Vercel 上会请求这两个函数。

注意：

- Vercel Function 的请求体上限是 4.5 MB，官方文档见 [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- 当前前端会在发送前检查图片大小；如果原图太大，会提示先裁剪水尺区域或压缩后再上传

## Prompt 设计思路

这版 prompt 针对的是“单图、任意角度、非固定机位”的众包场景，而不是固定摄像头视频流：

1. 强制模型先定位水尺，再读刻度，再推断水面线。
2. 明确每条白线和彩线对应 `2 cm`，允许在必要时做 `1 cm` 插值。
3. 要求模型在信息不足时输出 `manual_review`，避免伪精确。
4. 输出严格 JSON，便于页面直接结构化渲染。

## 当前实现说明

- 前端会在上传后自动把图片压缩到最长边 `1600px`，减少请求体积。
- 当前请求格式采用你给出的 Ark Responses API 结构：

```json
{
  "model": "doubao-seed-2-0-mini-260215",
  "input": [
    {
      "role": "system",
      "content": [{ "type": "input_text", "text": "..." }]
    },
    {
      "role": "user",
      "content": [
        { "type": "input_image", "image_url": "data:image/jpeg;base64,..." },
        { "type": "input_text", "text": "..." }
      ]
    }
  ]
}
```

## 建议的下一步

如果你后面要把它从 demo 升级成业务原型，建议继续做三件事：

1. 增加“先裁剪水尺区域，再送模型”的两阶段流程，减少整图干扰。
2. 建一小批人工标注样本，比较不同 prompt 和不同模型版本的误差。
3. 把 `manual_review` 样本沉淀成审核队列，逐步形成可复训的数据资产。

import fs from 'node:fs/promises';
import { lookup } from 'mime-types';

export class BailianProvider {
  constructor(env = process.env) {
    this.apiKey = env.DASHSCOPE_API_KEY || 'sk-8e24361b82b54b5098b89ab9f2620090';
    this.baseUrl = env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = env.BAILIAN_MODEL || 'qwen3.7-plus';
    this.timeoutMs = Number(env.BAILIAN_TIMEOUT_MS || 60000);
  }

  async analyzeImage({ imagePath, imageUrl, hazardLabels = [] }) {
    if (!this.apiKey) {
      const error = new Error('未配置百炼 API Key，可先手动填写隐患描述和整改建议后保存。');
      error.code = 'AI_CONFIG_MISSING';
      throw error;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const modelImageUrl = await resolveModelImageUrl({ imagePath, imageUrl });
      const labels = Array.isArray(hazardLabels) && hazardLabels.length
        ? `用户已手动标记的常见隐患类型为：${hazardLabels.join('、')}。请优先结合图片可见内容和这些标签生成草稿。`
        : '';
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: modelImageUrl } },
                {
                  type: 'text',
                  text:
                    `请作为高速公路施工安全隐患排查助手，基于图片中可见内容输出 JSON。字段必须为 hazardDescription 和 rectificationSuggestion。不要编造图片中看不到的事实。${labels}`
                }
              ]
            }
          ]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || '百炼接口调用失败');
      }
      const content = payload?.choices?.[0]?.message?.content || '';
      return parseModelText(content, this.model);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('百炼接口调用超时，请稍后重试。');
      }
      const cause = error.cause;
      if (error.message === 'fetch failed' || cause?.code) {
        const code = cause?.code ? `（${cause.code}）` : '';
        throw new Error(`无法连接百炼接口${code}，请检查服务器网络、代理或防火墙设置。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function resolveModelImageUrl({ imagePath, imageUrl }) {
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (!imagePath) return imageUrl;
  const bytes = await fs.readFile(imagePath);
  const mime = lookup(imagePath) || 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function parseModelText(content, modelName = '') {
  let hazardDescription = '';
  let rectificationSuggestion = '';

  try {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      hazardDescription = parsed.hazardDescription || parsed['隐患描述'] || '';
      rectificationSuggestion = parsed.rectificationSuggestion || parsed['整改建议'] || '';
    }
  } catch {
    // Fall back to splitting below.
  }

  if (!hazardDescription && !rectificationSuggestion) {
    const text = String(content).trim();
    const parts = text.split(/整改建议[:：]/);
    hazardDescription = parts[0].replace(/^隐患描述[:：]/, '').trim();
    rectificationSuggestion = parts[1]?.trim() || '';
  }

  return {
    hazardDescription: hazardDescription || '请根据现场照片补充隐患描述。',
    rectificationSuggestion: rectificationSuggestion || '请结合规范要求补充整改建议。',
    rawModelOutput: String(content),
    modelName
  };
}

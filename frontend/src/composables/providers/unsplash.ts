// Unsplash Provider。
//
// 合规要求（Unsplash Guidelines，漏掉任一都算违规）：
// 1. 每次选用必须调 GET /photos/:id/download —— 纯计数端点，类似 GA 的 pageview；
// 2. 对 urls.raw 做裁剪缩放时**必须保留 URL 里的 ixid 参数**；
// 3. 必须展示署名：摄影师名 + Unsplash 来源。
//
// 速率限制：demo 模式 50 次/时，申请正式后 1000 次/时。个人浏览选图 50 次/时足够。
//
// 图片比例策略（关键）：
// fullUrl 用 fit=max 只限宽不限高，保留原始比例。早期用 fit=crop&h=600 预裁成
// 2.67:1，与实际全出血封面（4~7:1）叠加造成双重裁切，竖构图人像只剩头部。
// 现在裁切只发生一次：前端按自然比例算展示高度 + crop=faces 锚定人脸。
import type { ImageProvider, CoverPhoto } from '../imageProviders';
import { COVER_MAX } from '../imageProviders';

const API = 'https://api.unsplash.com';

// 保留原始比例、只限制宽度的 URL（fit=max 不会放大超过原图尺寸）
const naturalSized = (rawUrl: string, w: number): string => {
  const u = new URL(rawUrl);
  u.searchParams.set('w', String(w));
  u.searchParams.set('fit', 'max');
  u.searchParams.set('q', '80');
  return u.toString();
};

// 网格缩略图：固定比例的小图，用 crop=faces 锚定人脸，
// 让预览的取景与最终效果一致（早期缩略图与封面比例不一致，属于 WYSIWYG 缺失）
const thumbSized = (rawUrl: string, w: number, h: number): string => {
  const u = new URL(rawUrl);
  u.searchParams.set('w', String(w));
  u.searchParams.set('h', String(h));
  u.searchParams.set('fit', 'crop');
  // 回退链：先试人脸锚定，检测不到人脸时退回 entropy，最后退化为居中
  u.searchParams.set('crop', 'faces,entropy');
  return u.toString();
};

const mapPhoto = (p: any): CoverPhoto => ({
  id: p.id,
  author: p.user?.name ?? 'Unknown',
  authorUrl: p.user?.links?.html ?? 'https://unsplash.com',
  thumbUrl: thumbSized(p.urls?.raw ?? '', 400, 150),
  fullUrl: naturalSized(p.urls?.raw ?? '', COVER_MAX.w),
  sourceUrl: p.links?.html ?? 'https://unsplash.com',
  aspect: p.width && p.height ? p.width / p.height : undefined,
  dimensions: p.width && p.height ? `${p.width} × ${p.height}` : undefined,
});

const call = async (path: string, key: string): Promise<any> => {
  // Unsplash 的 Client-ID 走查询参数，无需 Authorization 头
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}client_id=${encodeURIComponent(key)}`);
  if (res.status === 401) throw new Error('Unsplash API Key 无效，请在设置中检查');
  if (res.status === 403) throw new Error('Unsplash 访问被拒（可能触发速率限制或应用被限制）');
  if (!res.ok) throw new Error(`Unsplash 请求失败：HTTP ${res.status}`);
  return res.json();
};

export const unsplashProvider: ImageProvider = {
  id: 'unsplash',
  name: 'Unsplash',
  needsKey: true,
  keyHelpUrl: 'https://unsplash.com/developers',

  async search(query, page, key) {
    const q = query.trim();
    if (!q) {
      // 无关键词时走「随机精选」端点，一次取多张
      const data = await call(`/photos/random?count=24&page=${page}`, key);
      const list = Array.isArray(data) ? data : [data];
      return list.filter(Boolean).map(mapPhoto);
    }
    const data = await call(
      `/search/photos?query=${encodeURIComponent(q)}&page=${page}&per_page=24`,
      key,
    );
    return (data.results ?? []).map(mapPhoto);
  },

  onSelected(photo, key) {
    // 合规要求：选用时通知 Unsplash（纯计数）。失败静默处理，不影响用户体验。
    void fetch(`${API}/photos/${encodeURIComponent(photo.id)}/download?client_id=${encodeURIComponent(key)}`).catch(() => {});
  },
};

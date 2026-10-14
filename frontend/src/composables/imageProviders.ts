// 封面图库 Provider 抽象层。
//
// 设计目标：让 Unsplash / Pexels 等图库可以互换，PageCoverPicker 只依赖这里的接口。
// 每个 Provider 负责三件事：搜索、把搜索结果转成缩略图 URL、把选中的图转成可下载 URL。
//
// 关于 API Key：由用户在各平台申请后自行填入设置，存 localStorage（独立键，不参与页面同步）。
// 这样 Key 不会进代码仓库，泄露范围仅限用户自己的浏览器——与 LocalFirst 定位一致。

export interface CoverPhoto {
  id: string;
  /** 摄影师名，用于署名展示（三家图库的硬性合规要求） */
  author: string;
  /** 摄影师主页，署名链接用 */
  authorUrl: string;
  /** 缩略图 URL（用于网格预览） */
  thumbUrl: string;
  /** 原图 URL（用于下载，保留原始比例） */
  fullUrl: string;
  /** 原图自然宽高比（w/h），用于前端计算封面展示高度；取不到时为 undefined */
  aspect?: number;
  /** 图片来源页，署名链接用 */
  sourceUrl: string;
  /** 原始尺寸描述，如 "1600 × 1067" */
  dimensions?: string;
}

export interface ImageProvider {
  id: string;
  name: string;
  /** 是否需要 API Key */
  needsKey: boolean;
  /** 申请 Key 的地址，未配置时引导用户去这里 */
  keyHelpUrl: string;
  /**
   * 搜索图片。
   * @param query 关键词（空字符串表示「精选/随机」）
   * @param page  页码，从 1 开始
   */
  search(query: string, page: number, key: string): Promise<CoverPhoto[]>;
  /** 选用成功后的回调，用于图库要求的下载计数等合规动作 */
  onSelected?(photo: CoverPhoto, key: string): void;
}

// 封面图片的存储上限。
//
// 重要：这里只限制「尺寸上限」，不强制比例。
// 早期实现用 w=1600&h=600&fit=crop 向 Unsplash 请求预裁成 2.67:1 的图，
// 而实际封面是全出血横幅（实测 1000×240 ≈ 4.2:1，宽屏下可达 6~7:1），
// 于是发生「服务端裁一次 + CSS 再裁一次」的双重裁切 —— 竖构图人像被切到只剩头部。
// 现在改为请求原始比例（fit=max），由前端按自然比例决定展示高度，
// 裁切决策只做一次，且发生在最了解上下文的这一侧。
export const COVER_MAX = { w: 1600, h: 1200 };

// 轻量 HTTP 封装：web 环境下统一复用原生 fetch，返回标准 Response，
// 由调用方自行判断 res.status / res.ok 并解析 res.json() / res.blob()。
//
// 命名缘起：在原生壳（Capacitor / Electron）里可在此替换为平台原生 HTTP
// 实现以绕过 CORS；当前 nexus.sunbcy.homes 是浏览器部署，直接走 fetch 即可。
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const opts: RequestInit = {
    credentials: 'include',
    ...options,
  };
  return fetch(url, opts);
}

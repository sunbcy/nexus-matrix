import {Capacitor, CapacitorHttp} from '@capacitor/core';

/**
 * 安卓 WebView 跨域 REST 请求的 CORS 绕过层。
 *
 * 背景：Capacitor 把本地资源挂在 https://localhost，而后端在 https://<域名>，
 * 两者不同源。后端若未放行该 Origin，WebView 会拦掉所有 REST 请求
 * （OPTIONS 预检 400、GET 无 Access-Control-Allow-Origin），表现为
 * 「地址填对了却提示无法连接后端」，并连带使 initSync 不建立 WebSocket。
 *
 * 做法：只在「原生平台 + 绝对 http(s) URL + 无请求体」时，改用 Capacitor 内置的
 * CapacitorHttp 原生 HTTP（HttpURLConnection，不受 WebView CORS 约束）。
 * 为什么不启用 CapacitorHttp 的全局 fetch patch：其注入脚本不传 responseType，
 * 二进制响应会被当文本解码，会破坏 /api/assets 的图片（res.blob()）。
 * 这里显式指定 responseType='blob'，并按响应类型还原字节，JSON 与二进制都安全。
 *
 * 带请求体的请求仍走浏览器 fetch：原生插件对 JSON body 的序列化依赖 dataType，
 * 字符串可能被二次 JSON 编码；且写操作主要由 WebSocket CLIENT_UPDATE 承担。
 * 服务端放行 CORS 后，这些请求也会自然恢复完整能力。
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isCrossOriginRead = Capacitor.isNativePlatform()
    && /^https?:\/\//i.test(url)
    && init.body == null;
  if (!isCrossOriginRead) return fetch(url, init);

  const headers: Record<string, string> = {};
  const h = init.headers;
  if (h instanceof Headers) h.forEach((v, k) => { headers[k] = v; });
  else if (Array.isArray(h)) h.forEach(([k, v]) => { headers[k] = String(v); });
  else if (h) Object.assign(headers, h as Record<string, string>);

  try {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      // JSON 响应由原生端 parseJSON 成对象；其余响应按 base64 返回原始字节。
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 30000,
    });
    const rawHeaders = (res.headers || {}) as Record<string, string>;
    const contentType = Object.entries(rawHeaders)
      .find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
    const respHeaders = new Headers();
    for (const [k, v] of Object.entries(rawHeaders)) {
      // 逐跳头 / 长度头不能透传给合成的 Response（body 已解码、长度已变化）
      if (/^(content-encoding|content-length|transfer-encoding|connection|set-cookie)$/i.test(k)) continue;
      try { respHeaders.set(k, v); } catch { /* 浏览器禁止的头，忽略 */ }
    }

    let body: BodyInit;
    const data = res.data;
    if (data === null || data === undefined) {
      body = '';
    } else if (typeof data === 'object') {
      body = JSON.stringify(data);           // 原生端已把 JSON 解析成对象
    } else if (typeof data === 'string') {
      const textLike = /text\/|json|xml|javascript|urlencoded/i.test(contentType) || res.status >= 400;
      body = textLike || !data ? data : base64ToBytes(data);
    } else {
      body = String(data);
    }
    // 204/205/304 不允许带 body，否则 Response 构造会抛 TypeError
    const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(nullBody ? null : body, {status: res.status, headers: respHeaders});
  } catch {
    // 原生 HTTP 插件不可用时退回浏览器 fetch：至少不比现状更差
    return fetch(url, init);
  }
}

function base64ToBytes(s: string): BodyInit {
  try {
    const bin = atob(s.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return s; // 不是 base64（例如错误响应里的纯文本）
  }
}

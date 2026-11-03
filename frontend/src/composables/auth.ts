// 账户 / 多工作区（P2 前端）。后端账户体系见 backend/auth.py。
//
// 关键设计：token 仍复用 localStorage 的 nexus_sync_api_key（与现有同步令牌同一字段），
// 只是值从「legacy API Key」换成「账户 JWT」。这样 useSync / assets 的发送逻辑零改动——
// OAuth 登录成功后后端把 JWT 经 /?apiKey=<jwt> 回传，runtimeConfig 已会写回该字段。
//
// 切换工作区 = 向 /api/auth/select-workspace 换发新 JWT，然后整页 reload，
// 让 useSync / assets 以新的 room 重连（最稳，避免改动模块级 const 令牌）。
import {computed, ref} from 'vue';
import {getRuntimeConfig, SYNC_API_KEY_STORAGE_KEY} from '../runtimeConfig';

const SYNC_SERVER = (getRuntimeConfig().syncServer || (import.meta as any).env?.VITE_SYNC_SERVER || '').replace(/\/+$/, '');
const API_BASE = SYNC_SERVER ? `${SYNC_SERVER}/api` : '/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  provider: string;
}
export interface Workspace {
  room: string;
  role: string;
  status: string;
  label: string | null;
}
export interface Member {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  label: string | null;
}
export interface InviteLink {
  token: string;
  room: string;
  role: string;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
}

// 模块级单例状态（所有引入方共享）
const token = ref<string>('');
const user = ref<AuthUser | null>(null);
const workspaces = ref<Workspace[]>([]);
const activeRoom = ref<string | null>(null);
const initialized = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

// 是否「已登录账户」：token 能解成账户即 true。
// 是否「访问密钥模式」：有 token 但不是账户（legacy key 或无效）→ 仍可同步，但不在账号体系内。
const isAccount = computed(() => !!user.value);
const isLegacyKey = computed(() => !!token.value && !user.value);

// 当前所在工作区（activeRoom）中「我」的角色 / 是否可管理成员
const members = ref<Member[]>([]);
const currentRole = computed(
  () => workspaces.value.find((w) => w.room === activeRoom.value)?.role,
);
const canManage = computed(() => currentRole.value === 'owner' || currentRole.value === 'admin');

// 邀请链接（open invite）：owner/admin 生成，任何已登录用户持链接即可加入
const inviteLinks = ref<InviteLink[]>([]);
const currentInviteUrl = ref('');
const linkBusy = ref(false);
const PENDING_INVITE_KEY = 'nexus_pending_invite';

// 后端是否启用 Google OAuth（未配置凭据时按钮需禁用/提示，避免「点击没反应」）
const googleEnabled = ref(false);

async function loadAccount(): Promise<void> {
  error.value = null;
  if (!token.value) {
    user.value = null;
    workspaces.value = [];
    activeRoom.value = null;
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    if (res.status === 200) {
      const d = await res.json();
      user.value = d.user ?? null;
      workspaces.value = d.workspaces ?? [];
      activeRoom.value = d.active_room ?? (workspaces.value[0]?.room ?? null);
    } else {
      // 401 / 其它：当前 token 不是账户 JWT（legacy key 或无效）→ 非账户态
      user.value = null;
      workspaces.value = [];
      activeRoom.value = null;
    }
  } catch {
    user.value = null;
    workspaces.value = [];
    activeRoom.value = null;
  }
}

async function init(): Promise<void> {
  if (initialized.value) return;
  token.value = localStorage.getItem(SYNC_API_KEY_STORAGE_KEY) || '';
  await loadAccount();
  await loadAuthConfig();
  // loadAccount 会先清空 error，故 auth_error 的解析放在其后，避免被覆盖
  readAuthError();
  initialized.value = true;
  await maybeConsumeInvite();
}

// 把 URL 上的 ?auth_error=<code> 翻译成可读提示并清掉参数，避免重复触发。
function readAuthError(): void {
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get('auth_error');
    if (!code) return;
    const map: Record<string, string> = {
      google_not_configured: 'Google 登录未配置（后端缺少 OAUTH_GOOGLE_ID / OAUTH_GOOGLE_SECRET）',
      oauth_failed: 'Google 登录失败，请重试',
      no_email: 'Google 账号未返回邮箱，无法登录',
    };
    error.value = map[code] || `登录失败：${code}`;
    history.replaceState(null, '', location.pathname + location.hash);
  } catch {
    /* ignore */
  }
}

async function loadAuthConfig(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (res.ok) googleEnabled.value = !!(await res.json()).google_oauth;
  } catch {
    googleEnabled.value = false;
  }
}

// 处理邀请链接：URL 参数优先；登录跳转（Google 回跳会改写 URL）可能丢失参数，
// 故首次见到即存入 localStorage，登录完成后再消费。已登录则直接接受并进入工作区。
async function maybeConsumeInvite(): Promise<void> {
  try {
    const params = new URLSearchParams(location.search);
    const urlInvite = params.get('invite');
    if (urlInvite) {
      localStorage.setItem(PENDING_INVITE_KEY, urlInvite);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch {
    /* ignore */
  }
  const invite = localStorage.getItem(PENDING_INVITE_KEY);
  if (invite && user.value) {
    await consumeInviteLink(invite);
  }
}

// 接受邀请链接：查看 →（未加入则）接受 → 切换到该工作区并 reload。
async function consumeInviteLink(invite: string): Promise<void> {
  if (!token.value) return;
  error.value = null;
  try {
    const v = await fetch(`${API_BASE}/workspaces/invite/${invite}`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    if (!v.ok) {
      error.value = '邀请链接无效或已失效';
      localStorage.removeItem(PENDING_INVITE_KEY);
      return;
    }
    const data = await v.json();
    if (data.expired) {
      error.value = '邀请链接已过期';
      localStorage.removeItem(PENDING_INVITE_KEY);
      return;
    }
    const room = data.room as string;
    if (data.status !== 'active') {
      const a = await fetch(`${API_BASE}/workspaces/invite/${invite}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.value}` },
      });
      if (!a.ok) {
        error.value = '接受邀请失败，请重试';
        return;
      }
    }
    localStorage.removeItem(PENDING_INVITE_KEY);
    await switchWorkspace(room);
  } catch {
    error.value = '接受邀请失败，请重试';
  }
}

function loginWithGoogle(): void {
  const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  if (isNative) {
    // 安卓：谷歌 OAuth 无法在 WebView 内完成——Google 会以 disallowed_useragent 拒绝
    // embedded WebView 的 OAuth 请求。改为走「系统浏览器代理 + 自定义 scheme 深链」方案
    // （详见 backend/auth.py 与 MainActivity 深链处理）：
    // 1) 把后端（OAuth 入口，须为公网 https）地址交给原生层，供深链回跳时构造回调 URL；
    // 2) 以 com.nexusmatrix.app://oauth/callback 作为 Google 回跳地址，由原生层拦截转交。
    // 关键修复：必须用「系统浏览器」打开 OAuth 入口，而非 WebView 内 window.location.assign
    // （后者既会被 Google 拒绝，又会在 file:// 协议下退化为 /api 相对路径跳到无效地址）。
    const syncServer = (
      getRuntimeConfig().syncServer ||
      (import.meta as any).env?.VITE_SYNC_SERVER ||
      ''
    ).replace(/\/+$/, '');
    // 没有后端地址时无法发起 OAuth（相对路径会打到 WebView 本地，必然失败）。
    // 给出明确指引而不是静默失败。
    if (!syncServer) {
      error.value = '安卓端 Google 登录需要后端：请先在下方「同步」填写后端地址（须为公网 https）并保存后再登录';
      return;
    }
    (window as any).NexusNativeBridge?.setOAuthBackend?.(syncServer);
    // 发给 Google 的 redirect_uri 必须是 https（Google 的 Web OAuth 客户端拒绝自定义 scheme），
    // 所以这里用「后端 https 回调」；令牌换发后后端会再用自定义 scheme 深链把 JWT 带回 App。
    // final=android 告诉后端最终走深链（见 backend/auth.py）。
    const redirectUri = `${syncServer}/api/auth/oauth/google/callback`;
    const oauthUrl = `${syncServer}/api/auth/oauth/google?redirect_uri=${encodeURIComponent(redirectUri)}&final=android`;
    const opened = (window as any).NexusNativeBridge?.openExternal?.(oauthUrl);
    // 兜底（老版本原生无 openExternal 桥）：仍尝试在 WebView 内跳转（可能被 Google 拒，仅降级）。
    if (!opened) window.location.assign(oauthUrl);
    return;
  }
  // Web：后端中转，跳 Google → 回调 → 回跳 /?apiKey=<jwt>（runtimeConfig 写回 localStorage）
  window.location.assign(`${API_BASE}/auth/oauth/google`);
}

async function switchWorkspace(room: string): Promise<void> {
  if (!token.value || !user.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`${API_BASE}/auth/select-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ room }),
    });
    if (!res.ok) {
      error.value = '切换失败，请重试';
      return;
    }
    const d = await res.json();
    if (d.token) {
      localStorage.setItem(SYNC_API_KEY_STORAGE_KEY, d.token);
      window.location.reload(); // 让 useSync / assets 以新 room 重连
      return;
    }
    error.value = '未返回新令牌';
  } catch {
    error.value = '切换失败，请重试';
  } finally {
    loading.value = false;
  }
}

function logout(): void {
  localStorage.removeItem(SYNC_API_KEY_STORAGE_KEY);
  window.location.reload();
}

async function loadMembers(room: string | null): Promise<void> {
  if (!token.value || !room) { members.value = []; return; }
  try {
    const res = await fetch(`${API_BASE}/workspaces/${encodeURIComponent(room)}/members`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    members.value = res.ok ? ((await res.json()).members ?? []) : [];
  } catch {
    members.value = [];
  }
}

async function inviteMember(room: string | null, email: string, role: string): Promise<boolean> {
  if (!token.value || !room) return false;
  error.value = null;
  try {
    const res = await fetch(`${API_BASE}/workspaces/${encodeURIComponent(room)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) { error.value = '邀请失败，请重试'; return false; }
    await loadMembers(room);
    return true;
  } catch { error.value = '邀请失败，请重试'; return false; }
}

async function changeRole(room: string | null, userId: string, role: string): Promise<boolean> {
  if (!token.value || !room) return false;
  error.value = null;
  try {
    const res = await fetch(
      `${API_BASE}/workspaces/${encodeURIComponent(room)}/members/${encodeURIComponent(userId)}/role`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
        body: JSON.stringify({ role }),
      },
    );
    if (!res.ok) { error.value = '修改失败，请重试'; return false; }
    await loadMembers(room);
    return true;
  } catch { error.value = '修改失败，请重试'; return false; }
}

async function removeMember(room: string | null, userId: string): Promise<boolean> {
  if (!token.value || !room) return false;
  error.value = null;
  try {
    const res = await fetch(
      `${API_BASE}/workspaces/${encodeURIComponent(room)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token.value}` } },
    );
    if (!res.ok) { error.value = '移除失败，请重试'; return false; }
    await loadMembers(room);
    return true;
  } catch { error.value = '移除失败，请重试'; return false; }
}

// 接受邀请：pending → active，然后直接换发该工作区 JWT 并 reload 进入
async function acceptInvite(room: string): Promise<void> {
  if (!token.value) return;
  error.value = null;
  try {
    const a = await fetch(`${API_BASE}/workspaces/${encodeURIComponent(room)}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
    });
    if (!a.ok) { error.value = '接受失败，请重试'; return; }
    const s = await fetch(`${API_BASE}/auth/select-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ room }),
    });
    if (!s.ok) { error.value = '进入失败，请重试'; return; }
    const d = await s.json();
    if (d.token) {
      localStorage.setItem(SYNC_API_KEY_STORAGE_KEY, d.token);
      window.location.reload();
    }
  } catch { error.value = '接受失败，请重试'; }
}

// ---- 邀请链接（open invite） ----
async function loadInviteLinks(room: string | null): Promise<void> {
  if (!token.value || !room) { inviteLinks.value = []; return; }
  try {
    const res = await fetch(`${API_BASE}/workspaces/${encodeURIComponent(room)}/invite-links`, {
      headers: { Authorization: `Bearer ${token.value}` },
    });
    inviteLinks.value = res.ok ? ((await res.json()).links ?? []) : [];
  } catch {
    inviteLinks.value = [];
  }
}

async function generateInviteLink(room: string | null, role: string): Promise<void> {
  if (!token.value || !room) return;
  linkBusy.value = true;
  error.value = null;
  try {
    const res = await fetch(`${API_BASE}/workspaces/${encodeURIComponent(room)}/invite-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) { error.value = '生成链接失败，请重试'; return; }
    const d = await res.json();
    currentInviteUrl.value = `${location.origin}${d.url}`;
    await copyText(currentInviteUrl.value);
    await loadInviteLinks(room);
  } catch { error.value = '生成链接失败，请重试'; }
  finally { linkBusy.value = false; }
}

async function revokeLink(room: string | null, tokenStr: string): Promise<void> {
  if (!token.value || !room) return;
  error.value = null;
  try {
    const res = await fetch(
      `${API_BASE}/workspaces/${encodeURIComponent(room)}/invite-links/${encodeURIComponent(tokenStr)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token.value}` } },
    );
    if (!res.ok) { error.value = '撤销失败，请重试'; return; }
    if (currentInviteUrl.value.includes(tokenStr)) currentInviteUrl.value = '';
    await loadInviteLinks(room);
  } catch { error.value = '撤销失败，请重试'; }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 非安全上下文（如 http 局域网）剪贴板不可用，用户可手动复制输入框内容 */
  }
}

export function useAuth() {
  return {
    token, user, workspaces, activeRoom, initialized, loading, error,
    isAccount, isLegacyKey, members, currentRole, canManage, googleEnabled,
    inviteLinks, currentInviteUrl, linkBusy,
    init, loadAccount, loginWithGoogle, switchWorkspace, logout,
    loadMembers, inviteMember, changeRole, removeMember, acceptInvite,
    loadInviteLinks, generateInviteLink, revokeLink, copyText,
  };
}

# 后端联调 / 真机同步排查文档

本文档总结「安卓 App（前端）↔ 后端（uvicorn, `:8010`）」联调过程中踩过的坑与标准做法。
适用于：模拟器能同步、真机不能；或换网络 / 重装 APK 后同步失效等场景。

---

## 1. 架构与基本事实

| 项 | 值 | 说明 |
|---|---|---|
| 后端地址 | `http://<电脑局域网IP>:8010` | 纯 HTTP（**无 TLS**），填 `https://` 必失败 |
| 后端监听 | `0.0.0.0:8010` | 绑定所有网卡，含 Wi-Fi 网卡 |
| Vite dev server | `:5180` | 仅 `npm run dev` 运行时存在，调试阶段可用 |
| App 来源(origin) | `https://localhost` | Capacitor Android 在手机本地用 https 提供页面 |
| App 同步地址存储 | localStorage 键 `nexus_sync_server` | 格式必须为 `http://IP:8010` |
| 真实存储 | IndexedDB（`nexus-matrix` 库 / `kv` store，键 `nexus_matrix_pages_v3`） | 不要去读 `localStorage` 里的页面键，那是遗留键 |

> 端口记法：`8010` = 后端直连（推荐，最稳）；`5180` = Vite dev server（仅开发时挂着才通）。

---

## 2. 地址格式（最容易错）

正确示例（电脑 Wi-Fi IP 为 `192.168.124.15` 时）：
```
http://192.168.124.15:8010
```

铁律：

1. **必须 `http://`，不是 `https://`**。后端是纯 HTTP，填 `https://` 会在 TLS 握手阶段失败（`Failed to fetch`）。
2. **端口用 `8010`（后端），不是 `5180`（除非你明确在连 Vite dev）**。
3. **真机不要填 `localhost` / `10.0.2.2`** —— 这两个是模拟器专属别名：
   - `10.0.2.2` = 模拟器视角的「宿主机」；
   - `localhost` = 手机自己。
   填在真机上永远连不到电脑后端。
4. **`127.0.0.1` 只用于 USB 隧道场景**（见 §6），平时填电脑局域网 IP。

> 混合内容：App 页面是 `https://localhost`，向后端发 `http://` 请求属于混合内容。
> 原生壳已在 `capacitor.config` 设 `allowMixedContent: true`，且 `network_security_config.xml` 对 `192.168.0.0/16` 放行明文，因此 `http://` 后端请求是放行的。

---

## 3. Windows 防火墙（真机入站必过的一关）

模拟器访问 `:8010` 走宿主虚拟网卡 / NAT 回环，常能绕过防火墙；**真机从 Wi-Fi 进来是真正的入站流量**，Windows Defender 防火墙默认拒绝入站。

以**管理员** PowerShell 放行（两条都加最稳）：
```powershell
New-NetFirewallRule -DisplayName "Nexus Backend 8010" -Direction Inbound -Protocol TCP -LocalPort 8010 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "Nexus Dev 5180"   -Direction Inbound -Protocol TCP -LocalPort 5180 -Action Allow -Profile Any
```
`-Profile Any` 覆盖域/专用/公用，确保真机从「公用」Wi-Fi 进来也能过。

> 验证规则是否生效（普通 PowerShell 即可读）：
> ```powershell
> Get-NetFirewallRule | Where-Object { $_.DisplayName -like "Nexus*" } | Select-Object DisplayName, Direction, Action
> ```
> 验证端口是否在该网卡放行（从电脑自身连自己，测试防火墙+监听）：
> ```powershell
> Test-NetConnection -ComputerName <电脑Wi-Fi IP> -Port 8010 | Select TcpTestSucceeded
> ```
> 返回 `True` = 电脑侧 100% 没问题，问题在更外层网络。

---

## 4. Wi-Fi 注意事项（真机 ↔ 电脑可达性）

真机要连到 `192.168.124.15:8010`，必须满足：

1. **手机和电脑连同一个 Wi-Fi / 同一局域网**，且手机拿到的 IP 是 `192.168.124.*`（同网段）。
   - 手机 IP 不是 `192.168.124.*` → 手机连了别的 SSID / 别的 VLAN，让手机连电脑正在用的那个 Wi-Fi。
2. **路由器未开启 AP/客户端隔离**（同 Wi-Fi 下设备互访被禁，家庭/公司路由常见）。
   - 现象：模拟器能、真机不能；电脑侧 `Test-NetConnection` 已 `True` 但手机仍不通。
   - 解决：路由器管理页关掉「AP 隔离 / 客户端隔离 / 访客隔离」，或把手机电脑都挪到无隔离的网络。

> 注：电脑防火墙规则救不了路由器层的拦截。若 `Test-NetConnection` 已 `True` 而手机浏览器仍打不开，基本就是 AP 隔离或子网不对。

### 快速自测（决定性）
手机浏览器直接打开：
```
http://<电脑Wi-Fi IP>:8010/api/pages
```
- 返回 JSON → 网络+防火墙都通，问题在 App 配置；
- 打不开/超时 → 问题在网络或防火墙，与 App 代码无关。

---

## 5. 构建顺序（release 包别漏修复）

`gradlew assembleRelease` **不会自动执行** `npx cap copy android`。正确顺序：

```powershell
npm run build
npx cap copy android        # 把最新的 capacitor.config / web 资源写进 android 资产（必须在 assembleRelease 之前）
cd android
gradlew assembleRelease
```

若改动 `capacitor.config`（如混合内容开关）后没先 `cap copy` 就直接 `assembleRelease`，release APK 里打包的还是旧配置。

> 验证 release APK 内打包的配置：
> 用压缩工具打开 `android/app/build/outputs/apk/release/*.apk`，查看 `assets/capacitor.config.json`，确认 `allowMixedContent: true`。

---

## 6. USB 隧道（绕过 Wi-Fi 的快速验证法）

手机 USB 连电脑（adb 调试开着），用反向隧道把「手机 localhost:8010」映射到「电脑 localhost:8010」，完全不经过 Wi-Fi：

```powershell
adb reverse tcp:8010 tcp:8010
```
然后在手机 App 设置里把同步地址改为：
```
http://127.0.0.1:8010
```
手机浏览器验证也用 `http://127.0.0.1:8010/api/pages`。

- 适用：临时调试、路由器有 AP 隔离且改不了时。
- 限制：仅 USB 保持连接时有效；拔线 / 重启手机 / 重启 adbd 后隧道失效。
- 移除：`adb reverse --remove tcp:8010`。

---

## 7. 排查决策树

```
模拟器能同步、真机不能？
└─ 先看真机浏览器能否打开 http://<电脑IP>:8010/api/pages
   ├─ 打不开 → 网络/防火墙问题（§3、§4）
   │   ├─ 电脑 Test-NetConnection 返回 True → Wi-Fi 层：子网不对 / AP 隔离
   │   └─ 返回 False → 后端没监听 / 防火墙规则没建好
   └─ 能打开 JSON，但 App 不同步 → App 配置问题
       ├─ 确认地址是 http://（非 https://）、端口 8010、非 localhost/10.0.2.2
       ├─ 确认 release 包带 allowMixedContent:true（§5）
       └─ 看日志：出现「后端不可用」= 地址为空或 https 或不可达
```

### 日志关键字
- `TcpMetricsLogger: connect dst=[IP]:8010 err=0` → App 已正确连到后端（地址生效）。
- `[NEXUS SYNC] 后端不可用，进入纯本地模式` → 地址为空（ESM 时序 bug，已修）/ https 握手失败 / 后端不可达。

---

## 8. 已知已修复的代码坑（备忘）

1. **ESM import 提升导致同步地址锁死为空**：`useSync.ts` 原在模块加载时读 `getRuntimeConfig().syncServer`，但 `initRuntimeConfig()` 被 `import App` 提升挡在后面 → `SYNC_SERVER` 永为空，App 一直连相对路径 `/api`（即连自己 localhost）。
   修复：`runtimeConfig.ts` 在模块加载时自调用 `initRuntimeConfig()`，确保依赖方读取前 `__NEXUS_CONFIG__` 已就绪。
2. **混合内容**：`capacitor.config` 设 `allowMixedContent: true`（见 §2 注）。
3. **地址协议**：用户曾填 `https://`，已统一改为 `http://`。

---

## 9. 重装 / 换网络后速查

- 清数据或重装后，设置里同步地址需重新填 `http://<电脑当前Wi-Fi IP>:8010`（http 不是 https）。
- 电脑 IP 可能随 DHCP 变化，填之前先用 `ipconfig` / `Get-NetIPAddress` 确认当前 Wi-Fi 网卡 IP。
- 保持：电脑防火墙放行 8010、手机与电脑同 Wi-Fi（无 AP 隔离）、后端 `:8010` 在运行。

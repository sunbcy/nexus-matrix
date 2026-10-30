$wsUrl = "ws://127.0.0.1:9222/devtools/page/F5051256EA43B6BF75840348B824DEEE"
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync($wsUrl, $ct).Wait()

function Eval($id, $expr, $await=$false) {
  $js = $expr | ConvertTo-Json
  $params = if ($await) { ',"awaitPromise":true,"returnByValue":true' } else { ',"returnByValue":true' }
  $msg = '{"id":' + $id + ',"method":"Runtime.evaluate","params":{"expression":' + $js + $params + '}}'
  $b = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $ws.SendAsync([System.ArraySegment[byte]]$b, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
  Start-Sleep -Seconds 2
  $rb = New-Object byte[] 16384
  $r = $ws.ReceiveAsync([System.ArraySegment[byte]]$rb, $ct); $r.Wait()
  $enc = [System.Text.Encoding]::UTF8
  $txt = $enc.GetString($rb, 0, $r.Result.Count)
  $m = [regex]::Match($txt, '"value":(.*?)}\s*}')
  if ($m.Success) { return $m.Groups[1].Value }
  return $txt
}

Write-Output ("[cfg] localStorage.nexus_sync_server = " + (Eval 1 "localStorage.getItem('nexus_sync_server')"))
Write-Output ("[cfg] __NEXUS_CONFIG__             = " + (Eval 2 "JSON.stringify(window.__NEXUS_CONFIG__)"))
Write-Output ("[net] http  -> 192.168.124.15:8010/api/pages = " + (Eval 3 "fetch('http://192.168.124.15:8010/api/pages').then(r=>'HTTP_'+r.status).catch(e=>'ERR_'+e.message)" $true))
Write-Output ("[net] https -> 192.168.124.15:8010/api/pages = " + (Eval 4 "fetch('https://192.168.124.15:8010/api/pages').then(r=>'HTTP_'+r.status).catch(e=>'ERR_'+e.message)" $true))

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait()

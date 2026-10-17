# P02L local static server. Uses only what Windows already has built in
# (PowerShell + .NET's HttpListener) - nothing to install, no internet needed.
# Serves this folder on http://localhost:8080 so every window (TV, admin,
# cash desk, prize) shares one origin and their data stays in sync.
#
# Console messages below are deliberately in plain English only: a .ps1
# file without a BOM can be mis-decoded by Windows PowerShell 5.1's default
# console codepage, which would garble Cyrillic text here. The app's own
# Russian UI is unaffected - it's served as HTML with an explicit UTF-8
# charset, which every browser reads correctly regardless of this script.

$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Start()
} catch {
    Write-Host "Could not start the server on port $port - it may already be in use (maybe P02L is already running)."
    Write-Host "If P02L is already open in your browser, just open a new tab at http://localhost:$port/index.html"
    pause
    exit
}

Write-Host "P02L is running: http://localhost:$port/"
Write-Host "Keep this window open while you use the system. To stop: close this window or press Ctrl+C."
Start-Process "http://localhost:$port/index.html"

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".png"  = "image/png"
    ".json" = "application/json"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
        $localPath = $req.Url.LocalPath.TrimStart("/")
        if ([string]::IsNullOrEmpty($localPath)) { $localPath = "index.html" }
        $filePath = Join-Path $root $localPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $contentType = $mime[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $contentType
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $localPath")
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.OutputStream.Close()
    }
}

@echo off
chcp 65001 >nul 2>&1
setlocal

echo ======================================
echo  Hermes Agent Studio - Docker 启动
echo ======================================
echo.

cd /d "%~dp0.."

REM 启动 Docker 容器
echo [ok] 启动 Docker 容器...
docker compose up -d --build

REM 启动宿主机辅助服务（一键打开目录等功能）
echo [ok] 启动宿主机辅助服务 (端口 18791)...
echo.
echo ======================================
echo  Hermes Agent Studio 已启动
echo  WebUI:     http://127.0.0.1:8790
echo  辅助服务:  http://127.0.0.1:18791
echo ======================================
echo.
echo 使用 "docker compose down" 停止容器
echo 按 Ctrl+C 停止辅助服务
echo.

python hermes-webui-studio\host_helper.py 18791 127.0.0.1

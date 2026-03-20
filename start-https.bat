@echo off
echo ================================
echo  Iniciando courier-app con HTTPS
echo ================================
echo.
echo  Vite HTTP  -> http://192.168.1.82:5176
echo  HTTPS proxy-> https://192.168.1.82:5177
echo.
echo  Abre en el celular:
echo  https://192.168.1.82:5177
echo.
echo  (Acepta el certificado auto-firmado en el navegador)
echo ================================
echo.
cd /d "%~dp0courier-app"
npm run dev:https

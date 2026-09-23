@echo off
rem ---------------------------------------------------------------------------
rem Plataforma de Estudos - atalho de inicializacao
rem Basta dar duplo clique. Esta janela e o servidor: deixe-a aberta enquanto
rem estiver usando a plataforma, e feche-a (ou use "Parar plataforma.bat")
rem para encerrar.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
setlocal
title Plataforma de Estudos
cd /d "%~dp0"

set "ENDERECO=http://localhost:5173"
set "ABRIR_NAVEGADOR=1"
if /i "%~1"=="--sem-navegador" set "ABRIR_NAVEGADOR=0"

echo.
echo   Plataforma de Estudos
echo   =====================
echo.

rem --- Node.js instalado? -----------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   [ERRO] Node.js nao foi encontrado neste computador.
  echo.
  echo   Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo   [ERRO] O npm nao foi encontrado, mesmo com o Node.js instalado.
  echo.
  echo   Reinstale o Node.js pelo instalador oficial ^(https://nodejs.org^),
  echo   que ja inclui o npm, e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "VERSAO_NODE=%%v"
echo   Node.js %VERSAO_NODE%

rem --- Ja esta rodando? -------------------------------------------------------
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo   A plataforma ja esta em execucao.
  echo.
  if "%ABRIR_NAVEGADOR%"=="1" (
    start "" "%ENDERECO%"
    echo   Abri o navegador em %ENDERECO%
  ) else (
    echo   Acesse %ENDERECO%
  )
  echo   Para encerrar, feche a janela que esta rodando a plataforma.
  echo.
  ping -n 6 127.0.0.1 >nul
  exit /b 0
)

rem --- Dependencias instaladas? ----------------------------------------------
if not exist "node_modules" goto instalar
if not exist "server\node_modules" goto instalar
if not exist "client\node_modules" goto instalar
goto dependencias_ok

:instalar
echo.
echo   Primeira execucao: instalando as dependencias.
echo   Isso pode levar alguns minutos e so acontece uma vez.
echo.
call npm install
if errorlevel 1 (
  echo.
  echo   [ERRO] A instalacao das dependencias falhou.
  echo   Veja as mensagens acima para entender o motivo.
  echo.
  pause
  exit /b 1
)

:dependencias_ok

rem --- Aviso sobre a chave da IA ---------------------------------------------
if not exist ".env" (
  echo.
  echo   Aviso: o arquivo .env nao existe, entao a IA vai rodar em modo simulado.
  echo   Para ligar a IA de verdade, copie .env.example para .env e preencha
  echo   GEMINI_API_KEY. A plataforma funciona normalmente sem isso.
)

rem --- Abre o navegador assim que o site responder ----------------------------
if "%ABRIR_NAVEGADOR%"=="1" (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
    "for($i=0; $i -lt 90; $i++){ try { $r = Invoke-WebRequest -Uri '%ENDERECO%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process '%ENDERECO%'; break } } catch { Start-Sleep -Milliseconds 800 } }"
)

echo.
echo   Subindo a plataforma...
echo   O navegador abre sozinho em %ENDERECO% quando tudo estiver pronto.
echo.
echo   Mantenha esta janela aberta enquanto estiver usando.
echo   Para encerrar: feche esta janela ou pressione Ctrl+C.
echo.

call npm run dev

rem Se chegou aqui, o servidor parou (por Ctrl+C ou por erro).
echo.
echo   A plataforma foi encerrada.
echo.
pause
endlocal

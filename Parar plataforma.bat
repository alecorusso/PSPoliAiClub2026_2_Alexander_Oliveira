@echo off
rem ---------------------------------------------------------------------------
rem Plataforma de Estudos - encerra o que ficou rodando
rem Normalmente basta fechar a janela da plataforma. Use este arquivo quando
rem algum processo continuar ocupando as portas 3333 (servidor) ou 5173 (site).
rem ---------------------------------------------------------------------------
chcp 65001 >nul
setlocal enabledelayedexpansion
title Parar a Plataforma de Estudos

echo.
echo   Encerrando a Plataforma de Estudos
echo   ==================================
echo.

set "ENCERRADOS=0"

rem Mata apenas quem estiver ouvindo nas portas da plataforma, para nao
rem derrubar outros programas em Node que voce esteja rodando.
for %%P in (3333 5173) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /PID %%I /T /F >nul 2>&1
    if not errorlevel 1 (
      echo   Porta %%P liberada ^(processo %%I^).
      set /a ENCERRADOS+=1
    )
  )
)

if "%ENCERRADOS%"=="0" (
  echo   Nada estava rodando nas portas 3333 e 5173.
) else (
  echo.
  echo   Pronto.
)

echo.
rem pausa curta que nao depende da entrada padrao
ping -n 5 127.0.0.1 >nul
endlocal

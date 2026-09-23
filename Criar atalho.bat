@echo off
rem ---------------------------------------------------------------------------
rem Plataforma de Estudos - cria o atalho que pode ser fixado na barra de tarefas
rem
rem O Windows nao deixa fixar um .bat direto: so .exe ou atalhos para .exe.
rem Por isso o atalho aponta para o cmd.exe, que por sua vez chama o
rem "Iniciar plataforma.bat".
rem
rem Rode este arquivo tambem se voce mover ou renomear a pasta do projeto,
rem porque o atalho guarda o caminho completo.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Criar atalho da Plataforma de Estudos

echo.
echo   Criando o atalho
echo   ================
echo.

if not exist "Iniciar plataforma.bat" (
  echo   [ERRO] "Iniciar plataforma.bat" nao esta nesta pasta.
  echo   Mantenha os arquivos juntos na raiz do projeto.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$raiz = (Get-Location).Path;" ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$a = $shell.CreateShortcut((Join-Path $raiz 'Plataforma de Estudos.lnk'));" ^
  "$a.TargetPath = \"$env:SystemRoot\System32\cmd.exe\";" ^
  "$a.Arguments = '/c \"\"' + (Join-Path $raiz 'Iniciar plataforma.bat') + '\"\"';" ^
  "$a.WorkingDirectory = $raiz;" ^
  "if (Test-Path (Join-Path $raiz 'plataforma.ico')) { $a.IconLocation = (Join-Path $raiz 'plataforma.ico') + ',0' };" ^
  "$a.Description = 'Abre a Plataforma de Estudos no navegador';" ^
  "$a.WindowStyle = 1;" ^
  "$a.Save()"

if errorlevel 1 (
  echo   [ERRO] Nao foi possivel criar o atalho.
  echo.
  pause
  exit /b 1
)

echo   Pronto: "Plataforma de Estudos.lnk" nesta pasta.
echo.
echo   Para fixar na barra de tarefas:
echo     1. Clique com o botao direito no atalho.
echo     2. No Windows 11, escolha "Mostrar mais opcoes".
echo     3. Clique em "Fixar na barra de tarefas".
echo.
echo   Se preferir, arraste o atalho para a area de trabalho antes de fixar.
echo.
pause
endlocal

@echo off
setlocal
cd /d "%~dp0"

where gh >nul 2>&1 || (echo GitHub CLI "gh" is not installed. & exit /b 1)
gh auth status >nul 2>&1 || (echo Not logged in to GitHub. Run "gh auth login" first. & exit /b 1)

call npm version patch --no-git-tag-version >nul || (echo Version bump failed. & exit /b 1)
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set TAG=v%VERSION%
set EXE=release\0x-5mServerControl-%VERSION%.exe

set MESSAGE=%*
if "%MESSAGE%"=="" set MESSAGE=Release %TAG%

echo Building %TAG% ...
call npm run dist || (echo Build failed, nothing was committed or released. & git checkout -- package.json package-lock.json & exit /b 1)
if not exist "%EXE%" (echo Build output %EXE% not found. & exit /b 1)

echo Committing and pushing ...
git add -A || exit /b 1
git commit -m "%MESSAGE%" || (echo Commit failed. & exit /b 1)
for /f "delims=" %%b in ('git branch --show-current') do set BRANCH=%%b
git push -u origin %BRANCH% || (echo Push failed. & exit /b 1)

echo Creating GitHub release %TAG% ...
gh release create %TAG% "%EXE%" --target %BRANCH% --title "%TAG%" --generate-notes || (echo Release failed. & exit /b 1)

echo Done: %TAG% released.
endlocal

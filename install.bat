@echo off
REM A single `pnpm install` installs both the server and client (pnpm
REM workspace) and builds everything via the root "prepare" script.
echo Installing dependencies and building (root + client, via pnpm workspace)...
call pnpm install

echo.
echo ======================================
echo Installation complete!
echo.
echo To start the application, run:
echo npm start
echo ======================================

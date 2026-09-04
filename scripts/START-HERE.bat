@echo off
REM ==========================================================================
REM   Runloop - START HERE
REM ==========================================================================
REM   Just double-click this file. That's it!
REM
REM   The first time, it installs everything you need (and will ask you to
REM   restart your computer once). Every time after that, it just starts the
REM   app for you.
REM ==========================================================================

title Runloop

REM Run the real setup script (PowerShell). The script handles asking for
REM permission, showing progress, and pausing on any problem itself, so we
REM do not add our own pause here (that would double up the messages).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-setup.ps1"

REM Only show this if PowerShell itself could not be launched at all.
if not exist "%~dp0windows-setup.ps1" (
    echo.
    echo Could not find the setup file next to this one.
    echo Please make sure you did not move START-HERE out of the scripts folder.
    echo.
    pause
)

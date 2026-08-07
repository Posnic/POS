; Posnic - Custom NSIS Installer Script
; This script is included during the installation process

; Ultra-fast installation like VSCode/Windsurf
SetCompressor /SOLID lzma
SetCompressorDictSize 32
SetDatablockOptimize on

; The file list stays visible - a shop watching an installer that says nothing
; for two minutes assumes it has hung.
;
; Colours are ink on white rather than the green-on-black this used to be. That
; scheme reads as a terminal from 1998, and the setup wizard is the first thing
; anyone sees of this product. Foreground first, then background.
!define MUI_INSTFILESPAGE_COLORS "1F2937 FFFFFF"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

; Wording on the welcome and finish pages. The defaults are electron-builder's
; generic strings; a shop installing a till reads these once, and they are the
; only chance to say what this is and what to expect.
;
; $\r$\n is NSIS's line break. It has to reach makensis as those characters -
; writing a real carriage return here ends the string early and the build fails
; with "unterminated string".
!define MUI_WELCOMEPAGE_TITLE "Welcome to Posnic"
!define MUI_WELCOMEPAGE_TEXT "Posnic is a point of sale that works without internet. Your sales, stock and customers stay on this computer.$\r$\n$\r$\nSetup installs the application and its database. The first launch takes a few minutes while the database is prepared; later launches take seconds.$\r$\n$\r$\nClose any running copy of Posnic before continuing."
; Kept short on purpose. MUI gives the finish page a fixed text area above the
; "run now" checkbox and silently clips whatever does not fit - the first
; version of this ended mid-sentence at "your data is on this".
!define MUI_FINISHPAGE_TITLE "Posnic is installed"
!define MUI_FINISHPAGE_TEXT "The first launch prepares the database and opens the setup wizard, where you name your shop and create an administrator account.$\r$\n$\r$\nKeep that password safe. Your data lives on this machine."
!define MUI_FINISHPAGE_RUN_TEXT "Start Posnic now"




; Ensure install/uninstall details (file list) are always visible
ShowInstDetails show
ShowUninstDetails show

Var POSNIC_REPAIR_MODE
Var POSNIC_START_MENU_FOLDER
Var POSNIC_DELETE_DATA

; Posnic stores its runtime and user-specific data under the current profile.
; Force per-user installation and skip the redundant all-users/current-user page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Add a Start Menu folder selection step after the install-location page.
; Existing branding, icons, install logic, and finish page remain unchanged.
!macro customPageAfterChangeDir
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "Posnic"
  !define MUI_STARTMENUPAGE_REGISTRY_ROOT "HKCU"
  !define MUI_STARTMENUPAGE_REGISTRY_KEY "Software\Posnic"
  !define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "Start Menu Folder"
  !insertmacro MUI_PAGE_STARTMENU Posnic $POSNIC_START_MENU_FOLDER
!macroend

; Detect same-machine repair/install-over-existing before files are replaced
!macro customInit
  StrCpy $POSNIC_REPAIR_MODE "0"
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 repair_mode_done
    StrCpy $POSNIC_REPAIR_MODE "1"
  repair_mode_done:
!macroend

; Custom installation messages
!macro customInstall
  ; What the shop is getting, on the line above the progress bar while the
  ; last of the install finishes.
  ;
  ; textonly writes to that line without adding to the file list, so it reads
  ; as status rather than log noise. Nothing here sleeps: padding the install
  ; to make a message linger would trade a slower setup for a prettier one,
  ; which is the wrong way round.
  SetDetailsPrint textonly
  DetailPrint "Preparing your database and setting up the till..."
  SetDetailsPrint both
  DetailPrint "========================================="
  DetailPrint "Posnic Installation Starting"
  DetailPrint "Installation started at: $\r$\n"
  DetailPrint "========================================="

  StrCmp $POSNIC_REPAIR_MODE "1" repair_mode_detected normal_install_mode
  repair_mode_detected:
    DetailPrint "REPAIR MODE DETECTED"
    DetailPrint "Repairing Posnic application files..."
    DetailPrint "Database and backups will be kept."
    Goto install_mode_done
  normal_install_mode:
    DetailPrint "INSTALL/UPDATE MODE"
  install_mode_done:
  
  ; ── Close any running instance of Posnic before installing ──
  DetailPrint "[TIME CHECK] Step 1 START: Process termination"
  
  ; Kill all possible process names (fast mode)
  DetailPrint "Terminating running instances..."
  nsExec::ExecToLog 'taskkill /F /IM "Posnic.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "posnic.exe" /T'
  
  ; Minimal wait for process termination
  DetailPrint "Waiting 500ms for process cleanup..."
  Sleep 500
  
  DetailPrint "[TIME CHECK] Step 1 COMPLETE: Process termination done"

  DetailPrint "[TIME CHECK] Step 2 START: File extraction"
  DetailPrint "Installing Posnic files..."
  DetailPrint "Target: $INSTDIR"
  DetailPrint "This may take 10-60 seconds depending on disk speed..."
  
  ; Note: File extraction happens here automatically by NSIS
  ; We can't add timing in the middle, but we'll time before/after
  
  DetailPrint "[TIME CHECK] Step 3 START: Shortcuts creation"
  
  DetailPrint "Creating desktop shortcut..."
  CreateShortcut "$DESKTOP\Posnic.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\app.ico" 0
  
  DetailPrint "Creating start menu shortcut..."
  ; electron-builder creates its default link before customInstall. Replace only
  ; that Start Menu link with the folder selected on the wizard page.
  Delete "$newStartMenuLink"
  RMDir "$SMPROGRAMS\Posnic"
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Posnic
    CreateDirectory "$SMPROGRAMS\$POSNIC_START_MENU_FOLDER"
    CreateShortcut "$SMPROGRAMS\$POSNIC_START_MENU_FOLDER\Posnic.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\app.ico" 0
    StrCpy $newStartMenuLink "$SMPROGRAMS\$POSNIC_START_MENU_FOLDER\Posnic.lnk"
    StrCpy $launchLink "$newStartMenuLink"
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory "$POSNIC_START_MENU_FOLDER"
  !insertmacro MUI_STARTMENU_WRITE_END
  CreateDirectory "$DOCUMENTS\Posnic-Backups"
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Posnic
    CreateShortcut "$SMPROGRAMS\$POSNIC_START_MENU_FOLDER\Open Posnic Backups.lnk" "$WINDIR\explorer.exe" "$DOCUMENTS\Posnic-Backups"
  !insertmacro MUI_STARTMENU_WRITE_END
  
  DetailPrint "[TIME CHECK] Step 3 COMPLETE: Shortcuts created"
  
  DetailPrint "[TIME CHECK] Step 4 START: Registry configuration"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Posnic" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  DetailPrint "[TIME CHECK] Step 4 COMPLETE: Registry configured"
  
  DetailPrint "========================================="
  DetailPrint "Installation completed successfully!"
  DetailPrint "Total time: Check timestamps above"
  DetailPrint "========================================="
  
  ; Auto-restart app after update installation (silent mode only)
  DetailPrint "[TIME CHECK] Step 5 START: Auto-restart check"
  
  ; Check if installer is running in silent mode (update scenario)
  ; Silent mode = auto-update from running app
  ; Normal mode = user manually installing
  IfSilent is_silent_update is_manual_install
  
  is_silent_update:
    DetailPrint "SILENT UPDATE MODE - Auto-restart enabled"
    DetailPrint "Waiting 1 second before app launch..."
    Sleep 1000
    DetailPrint "[TIME CHECK] Step 6 START: App launch"
    DetailPrint "Launching: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
    
    ; Use Exec to launch app in background (detached process)
    ; This ensures app starts and continues running after installer exits
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    
    DetailPrint "[TIME CHECK] Step 6 COMPLETE: App launched successfully"
    DetailPrint "App is now running in background"
    DetailPrint "Installer will close automatically in 2 seconds"
    Sleep 2000
    Goto end_restart_check
  
  is_manual_install:
    StrCmp $POSNIC_REPAIR_MODE "1" is_manual_repair is_manual_fresh_install

  is_manual_repair:
    DetailPrint "REPAIR MODE - Auto-restart enabled"
    DetailPrint "Waiting 1 second before app launch..."
    Sleep 1000
    DetailPrint "[TIME CHECK] Step 6 START: Repair app launch"
    DetailPrint "Launching: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    DetailPrint "[TIME CHECK] Step 6 COMPLETE: Repaired app launched successfully"
    DetailPrint "Database was kept. Shortcuts were recreated."
    Goto end_restart_check

  is_manual_fresh_install:
    DetailPrint "MANUAL INSTALL - User will launch app manually"
    DetailPrint "Click desktop shortcut or start menu to launch Posnic"
  
  end_restart_check:
  DetailPrint "[TIME CHECK] Installation process finished"
!macroend

; Let the user decide about their data; keeping it is the safe default.
; Deleting requires a second, explicit confirmation with a backup warning -
; for a local-only shop this data is the ONLY copy of their sales history.
!macro customUnInit
  StrCpy $POSNIC_DELETE_DATA "0"

  ; An upgrade runs the OLD uninstaller first, silently, purely to clear out the
  ; previous files - the installer's own log shows it as
  ;   old-uninstaller.exe /S /KEEP_APP_DATA
  ; Asking about data there is worse than pointless. The answer is always
  ; "keep", the person is in the middle of an install they think is routine, and
  ; a mis-click on "No" erases the only copy of their sales history. A silent
  ; run must keep the data and say nothing.
  ;
  ; NSIS does not skip a MessageBox in silent mode on its own: without /SD it
  ; still draws the dialog and waits, which is why this appeared mid-install and
  ; stalled there until it was answered.
  IfSilent unposnic_done

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Keep your business data (sales database and backups)?$\r$\n$\r$\nYES - Keep my data (recommended). Reinstalling Posnic later will find everything exactly as it was.$\r$\n$\r$\nNO - I want to permanently delete everything from this computer." /SD IDYES IDYES unposnic_done

  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "WARNING - PERMANENT DELETION$\r$\n$\r$\nThis will erase ALL sales history, inventory, customers and settings from this computer. If you do not use Posnic Cloud, this is the ONLY copy of your business data - it CANNOT be recovered.$\r$\n$\r$\nYour backup folder (Documents\Posnic-Backups) will also be deleted. If you may ever need this data, click NO now and first copy that folder to a pen drive or another computer.$\r$\n$\r$\nPermanently delete everything?" /SD IDNO IDYES unposnic_wipe
  Goto unposnic_done

  unposnic_wipe:
    StrCpy $POSNIC_DELETE_DATA "1"
  unposnic_done:
!macroend

; Custom uninstallation steps
!macro customUnInstall
  DetailPrint "Removing Posnic..."
  DetailPrint "Removing startup launcher..."
  
  ; Remove from Windows startup registry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Posnic"
  ReadRegStr $0 HKCU "Software\Posnic" "Start Menu Folder"
  StrCmp $0 "" 0 +2
    StrCpy $0 "Posnic"
  Delete "$SMPROGRAMS\$0\Open Posnic Backups.lnk"
  RMDir "$SMPROGRAMS\$0"
  DeleteRegValue HKCU "Software\Posnic" "Start Menu Folder"
  DeleteRegKey /ifempty HKCU "Software\Posnic"
  
  DetailPrint "Cleaning up application data..."
  StrCmp $POSNIC_DELETE_DATA "1" 0 unskipdata
    DetailPrint "Deleting database and backups (user choice)..."
    RMDir /r "$APPDATA\posnic"
    RMDir /r "$DOCUMENTS\Posnic-Backups"
  unskipdata:
!macroend

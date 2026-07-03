; Limboo — custom NSIS include, merged into electron-builder's well-tested NSIS
; script via the `nsis.include` option. Keep this minimal and additive: the base
; script already handles install/upgrade/uninstall, shortcuts, and the assisted
; multi-page wizard. We only layer on brand identity here.
;
; electron-builder invokes these named macros at the right points in its script.

; Branded run-after-finish prompt (shown on the final wizard page).
!define MUI_FINISHPAGE_RUN_TEXT "Launch Limboo"

; Runs before any files/shortcuts are written. Older builds installed under the
; lowercase "limboo" identity (and under a Start-menu vendor subfolder while
; menuCategory was on) — those stale shortcuts are what made Start's "Recently
; added" launch an outdated, Electron-branded exe. Scrub them here so an
; upgrade always leaves exactly one root-level "Limboo" identity. Deleting
; non-existent paths is a no-op in NSIS, and this runs BEFORE the new shortcuts
; are created, so the case-insensitive filesystem can't eat the fresh links.
!macro customInit
  Delete "$SMPROGRAMS\limboo.lnk"
  Delete "$DESKTOP\limboo.lnk"
  RMDir /r "$SMPROGRAMS\limboo"
  RMDir /r "$SMPROGRAMS\Limboo"
!macroend

; Runs as part of the install section, after files are written.
!macro customInstall
  ; Record the install under a stable brand key so Windows + future upgrades and
  ; the Add/Remove Programs entry all resolve to one identity. AppUserModelID
  ; itself is set from electron-builder's appId (dev.limboo.app).
  WriteRegStr SHCTX "Software\Limboo" "InstallChannel" "stable"
  WriteRegStr SHCTX "Software\Limboo" "InstalledVersion" "${VERSION}"
!macroend

; Runs as part of the uninstall section. The user's workspaces, local database
; (limboo.db), memories, logs, and terminal history live under %APPDATA%\Limboo
; and are intentionally LEFT IN PLACE (deleteAppDataOnUninstall: false) so a
; reinstall or upgrade keeps the developer's data. Only our brand key is removed.
!macro customUnInstall
  DeleteRegKey SHCTX "Software\Limboo"
!macroend

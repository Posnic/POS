# Desktop settings

Routine controls belong to the module they configure. The desktop menu and
system tray retain independent windows for recovery when the main app or API
cannot load.

| Location in the app                      | Controls                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Core Settings → Print → Printer Settings | Receipt and document destinations, paper, copies and automatic receipt printing    |
| Core Settings → Print → Receipt Design   | Receipt layouts, content and preview                                               |
| Devices & Printing                       | Cash drawer preferences and links to connection, calibration and print diagnostics |
| App Settings                             | Start at login on Windows/macOS; background operation information                  |
| Software Updates                         | Automatic checks, frequency, install on quit and release channel                   |
| Backup & Recovery                        | Local backup schedule, destination and retention                                   |
| Cloud Sync                               | Connection status, last successful sync and pending uploads                        |
| System Status                            | Installed version, platform, logs and diagnostics                                  |
| Restaurant → KOT printing                | Branch, kitchen printers, paper, copies and pause/resume                           |

These desktop preferences belong to the computer. The app uses the same IPC
services and configuration files as Hardware Manager, Backup Manager and
Software Updates. Receipt designs and automatic receipt printing retain their
existing branch scope. No settings are added to Features switch cards.

The native File/tray menus keep Hardware Manager, updates/revert, local
backup/restore, cloud connection and restart/quit independently accessible.
Advanced hardware connection and calibration still open the appropriate native
panel. Cloud installations do not offer local database restore.

An explicit KOT pause persists as `enabled: false`. Restarting or opening a
settings window does not resume it. Ordinary application shutdown stops the
worker without changing the preference. A printing pass already in progress can
finish before the pause takes full effect.

`desktop-design.css` supplies the shared utility-window layout and typography.
`window-theme.js` applies the shop palette, updates open windows when the theme
changes, and supplies keyboard tab navigation. About remains sandboxed without
a privileged preload. Bundled fonts keep utility windows usable offline.

The native layout, navigation bridge and persistent KOT pause need a new desktop
build. A frontend-only update cannot add those capabilities to an older shell.

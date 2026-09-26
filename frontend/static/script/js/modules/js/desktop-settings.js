/* Settings and the independent recovery windows use the same desktop services.
   No machine preference is written to the shop's shared settings document. */
(function () {
    'use strict';
    var api = window.electronAPI, backup = window.electron;
    var revision = {}, states = {}, kitchenRunning = false;
    var sections = {
        devices: ['Devices & Printing', 'Printer connections and accessories on this computer.'],
        app: ['App Settings', 'Choose how Posnic starts on this computer.'],
        updates: ['Software Updates', 'Update preferences for this installation.'],
        backups: ['Backup & Recovery', 'Protect the local shop database with scheduled backups.'],
        cloudsync: ['Cloud Sync', 'Connection and synchronization for this computer.'],
        systemstatus: ['System Status', 'Diagnostics and support when something needs attention.'],
        kitchen: ['Kitchen Printing', 'Automatically print tickets for the selected branch on this computer.']
    };
    function t(key, fallback) {
        switch (key) {
        case "save_failed": return PosnicPro.i18n.t('lang_desktop_save_failed', 'Could not save. Please try again.');
        case "receipt_default": return PosnicPro.i18n.t('lang_desktop_receipt_default', 'Use receipt printer');
        case "unavailable": return PosnicPro.i18n.t('lang_about_unavailable', 'Unavailable');
        case "receipts": return PosnicPro.i18n.t('lang_desktop_receipts', 'Receipts and documents');
        case "print_location": return PosnicPro.i18n.t('lang_desktop_print_location', 'Choose printers, paper and copies in Core Settings → Print → Printer Settings.');
        case "printer_settings": return PosnicPro.i18n.t('lang_desktop_printer_settings', 'Printer Settings');
        case "test_printers": return PosnicPro.i18n.t('lang_desktop_test_printers', 'Test printers & view print history');
        case "cash_drawer": return PosnicPro.i18n.t('lang_desktop_cash_drawer', 'Cash drawer');
        case "printer": return PosnicPro.i18n.t('lang_printer', 'Printer');
        case "drawer_pin": return PosnicPro.i18n.t('lang_desktop_drawer_pin', 'Drawer connector pin');
        case "drawer_auto": return PosnicPro.i18n.t('lang_desktop_drawer_auto', 'Open the cash drawer after a sale');
        case "save": return PosnicPro.i18n.t('lang_desktop_save', 'Save settings');
        case "drawer_test": return PosnicPro.i18n.t('lang_desktop_drawer_test', 'Test cash drawer');
        case "other_devices": return PosnicPro.i18n.t('lang_desktop_other_devices', 'Other devices');
        case "device_tools_help": return PosnicPro.i18n.t('lang_desktop_device_tools_help', 'Open the device panel to connect, calibrate or test hardware. These tools also remain available from the desktop menu.');
        case "scales": return PosnicPro.i18n.t('lang_desktop_scales', 'Weighing scale');
        case "scanner": return PosnicPro.i18n.t('lang_desktop_scanner', 'Barcode scanner');
        case "mobile": return PosnicPro.i18n.t('lang_desktop_mobile', 'Mobile devices');
        case "startup": return PosnicPro.i18n.t('lang_desktop_startup', 'Startup');
        case "start_login": return PosnicPro.i18n.t('lang_desktop_start_login', 'Start Posnic when I sign in to this computer');
        case "start_background": return PosnicPro.i18n.t('lang_desktop_start_background', 'Starts in the background, ready to open from the system tray.');
        case "os_startup": return PosnicPro.i18n.t('lang_desktop_os_startup', 'Manage startup applications in your operating system settings.');
        case "background": return PosnicPro.i18n.t('lang_desktop_background', 'Working in the background');
        case "background_help": return PosnicPro.i18n.t('lang_desktop_background_help', 'Closing the main window keeps Posnic running in the system tray. Kitchen printing and synchronization continue. Use Quit Posnic to stop the app.');
        case "update_preferences": return PosnicPro.i18n.t('lang_desktop_update_preferences', 'Update preferences');
        case "auto_check": return PosnicPro.i18n.t('lang_desktop_auto_check', 'Check for updates automatically');
        case "check_frequency": return PosnicPro.i18n.t('lang_desktop_check_frequency', 'How often');
        case "daily": return PosnicPro.i18n.t('lang_daily', 'Daily');
        case "weekly": return PosnicPro.i18n.t('lang_weekly', 'Weekly');
        case "install_quit": return PosnicPro.i18n.t('lang_desktop_install_quit', 'Install updates when I close Posnic');
        case "update_channel": return PosnicPro.i18n.t('lang_desktop_update_channel', 'Release channel');
        case "stable": return PosnicPro.i18n.t('lang_desktop_stable', 'Stable releases');
        case "beta": return PosnicPro.i18n.t('lang_desktop_beta', 'Test builds');
        case "channel_help": return PosnicPro.i18n.t('lang_desktop_channel_help', 'Use stable releases on a working till. Switching back does not undo a test build already installed; it waits for a newer stable release.');
        case "update_recovery": return PosnicPro.i18n.t('lang_desktop_update_recovery', 'Updates & recovery');
        case "update_recovery_help": return PosnicPro.i18n.t('lang_desktop_update_recovery_help', 'Check, download or revert an update in the independent update window. You can open it from the desktop menu even when this screen is unavailable.');
        case "open_updates": return PosnicPro.i18n.t('lang_desktop_open_updates', 'Open Updates & Recovery');
        case "cloud_backup": return PosnicPro.i18n.t('lang_desktop_cloud_backup', 'Cloud installation');
        case "cloud_backup_help": return PosnicPro.i18n.t('lang_desktop_cloud_backup_help', 'Local database backup and restore are available for Community installations. Manage cloud data recovery with your cloud provider.');
        case "backup_schedule": return PosnicPro.i18n.t('lang_desktop_backup_schedule', 'Backup schedule');
        case "auto_backups": return PosnicPro.i18n.t('lang_desktop_auto_backups', 'Create backups automatically');
        case "backup_folder": return PosnicPro.i18n.t('lang_desktop_backup_folder', 'Backup folder');
        case "browse": return PosnicPro.i18n.t('lang_filebrowse_title', 'Browse');
        case "frequency": return PosnicPro.i18n.t('lang_desktop_frequency', 'Frequency');
        case "hourly": return PosnicPro.i18n.t('lang_desktop_hourly', 'Hourly');
        case "time": return PosnicPro.i18n.t('lang_desktop_time', 'Time');
        case "day": return PosnicPro.i18n.t('lang_desktop_day', 'Day of week');
        case "sunday": return PosnicPro.i18n.t('lang_sunday', 'Sunday');
        case "monday": return PosnicPro.i18n.t('lang_monday', 'Monday');
        case "tuesday": return PosnicPro.i18n.t('lang_tuesday', 'Tuesday');
        case "wednesday": return PosnicPro.i18n.t('lang_wednesday', 'Wednesday');
        case "thursday": return PosnicPro.i18n.t('lang_thursday', 'Thursday');
        case "friday": return PosnicPro.i18n.t('lang_friday', 'Friday');
        case "saturday": return PosnicPro.i18n.t('lang_saturday', 'Saturday');
        case "retention": return PosnicPro.i18n.t('lang_desktop_retention', 'Keep backups for (days)');
        case "backup_restore": return PosnicPro.i18n.t('lang_desktop_backup_restore', 'Backup & restore');
        case "restore_help": return PosnicPro.i18n.t('lang_desktop_restore_help', 'Restore replaces shop data. The independent recovery window shows available backups and asks you to confirm before restoring.');
        case "backup_now": return PosnicPro.i18n.t('lang_desktop_backup_now', 'Back up now');
        case "browse_restore": return PosnicPro.i18n.t('lang_desktop_browse_restore', 'Browse backups & restore');
        case "sync_status": return PosnicPro.i18n.t('lang_desktop_sync_status', 'Sync status');
        case "connection": return PosnicPro.i18n.t('lang_connection', 'Connection');
        case "connected": return PosnicPro.i18n.t('lang_desktop_connected', 'Connected');
        case "not_connected": return PosnicPro.i18n.t('lang_desktop_not_connected', 'Not connected');
        case "sync": return PosnicPro.i18n.t('lang_desktop_sync', 'Sync');
        case "online": return PosnicPro.i18n.t('lang_desktop_online', 'Online');
        case "offline_retry": return PosnicPro.i18n.t('lang_desktop_offline_retry', 'Offline / retrying');
        case "last_sync": return PosnicPro.i18n.t('lang_desktop_last_sync', 'Last successful sync');
        case "pending": return PosnicPro.i18n.t('lang_desktop_pending', 'Waiting to upload');
        case "refresh": return PosnicPro.i18n.t('lang_desktop_refresh', 'Refresh status');
        case "manage_cloud": return PosnicPro.i18n.t('lang_desktop_manage_cloud', 'Manage cloud connection');
        case "installation": return PosnicPro.i18n.t('lang_desktop_installation', 'This installation');
        case "version": return PosnicPro.i18n.t('lang_desktop_version', 'Installed version');
        case "platform": return PosnicPro.i18n.t('lang_desktop_platform', 'Operating system');
        case "edition": return PosnicPro.i18n.t('lang_desktop_edition', 'Installation');
        case "view_logs": return PosnicPro.i18n.t('lang_desktop_view_logs', 'View application logs');
        case "hardware_diagnostics": return PosnicPro.i18n.t('lang_hardware_manager', 'Hardware Manager');
        case "about": return PosnicPro.i18n.t('lang_about_posnic', 'About Posnic');
        case "kitchen_running": return PosnicPro.i18n.t('lang_desktop_kitchen_running', 'Running - tickets print as orders arrive');
        case "kitchen_paused": return PosnicPro.i18n.t('lang_desktop_kitchen_paused', 'Paused - automatic kitchen printing is stopped');
        case "branch": return PosnicPro.i18n.t('lang_branch_title', 'Branch');
        case "paper": return PosnicPro.i18n.t('lang_desktop_paper', 'Paper');
        case "copies": return PosnicPro.i18n.t('lang_print_copies', 'Copies');
        case "kitchen_pause_help": return PosnicPro.i18n.t('lang_desktop_kitchen_pause_help', 'Pause finishes any ticket already being sent. The pause is remembered after restarting; opening settings never resumes printing.');
        case "kitchen_start": return PosnicPro.i18n.t('lang_desktop_kitchen_start', 'Save & resume printing');
        case "kitchen_pause": return PosnicPro.i18n.t('lang_desktop_kitchen_pause', 'Pause printing');
        case "print_history": return PosnicPro.i18n.t('lang_desktop_print_history', 'Print history & diagnostics');
        case "kitchen_worker": return PosnicPro.i18n.t('lang_desktop_kitchen_worker', 'Automatic kitchen printing');
        case "kitchen_devices": return PosnicPro.i18n.t('lang_desktop_kitchen_devices', 'Kitchen devices');
        case "kitchen_screen": return PosnicPro.i18n.t('lang_desktop_kitchen_screen', 'Kitchen screen');
        case "kitchen_sound": return PosnicPro.i18n.t('lang_desktop_kitchen_sound', 'Kitchen sound');
        case "desktop_only": return PosnicPro.i18n.t('lang_desktop_desktop_only', 'Open Posnic on this computer to manage connected devices and desktop settings.');
        case "permission": return PosnicPro.i18n.t('lang_desktop_permission', 'An administrator must open these settings.');
        case "loading": return PosnicPro.i18n.t('lang_desktop_loading', 'Loading settings…');
        case "this_computer": return PosnicPro.i18n.t('lang_desktop_this_computer', 'This computer');
        case "retry": return PosnicPro.i18n.t('lang_desktop_retry', 'Try again');
        case "folder_required": return PosnicPro.i18n.t('lang_desktop_folder_required', 'Choose a backup folder.');
        case "retention_invalid": return PosnicPro.i18n.t('lang_desktop_retention_invalid', 'Choose between 1 and 365 days.');
        case "time_required": return PosnicPro.i18n.t('lang_desktop_time_required', 'Choose a backup time.');
        case "backup_complete": return PosnicPro.i18n.t('lang_desktop_backup_complete', 'Backup completed. Open Browse backups & restore to view it.');
        case "copies_invalid": return PosnicPro.i18n.t('lang_print_valid_copies', 'Choose between 1 and 20 copies.');
        case "kitchen_required": return PosnicPro.i18n.t('lang_desktop_kitchen_required', 'Choose a branch and at least one kitchen printer.');
        case "saved": return PosnicPro.i18n.t('lang_desktop_saved', 'Settings saved.');
        case "working": return PosnicPro.i18n.t('lang_desktop_working', 'Working…');
        case "unsaved": return PosnicPro.i18n.t('lang_rd_unsaved_changes', 'Unsaved changes');
        case "devices": return PosnicPro.i18n.t('lang_desktop_devices', 'Devices & Printing');
        case "devices_help": return PosnicPro.i18n.t('lang_desktop_devices_help', 'Printer connections and accessories on this computer.');
        case "app": return PosnicPro.i18n.t('lang_desktop_app', 'App Settings');
        case "app_help": return PosnicPro.i18n.t('lang_desktop_app_help', 'Choose how Posnic starts on this computer.');
        case "updates": return PosnicPro.i18n.t('lang_desktop_updates', 'Software Updates');
        case "updates_help": return PosnicPro.i18n.t('lang_desktop_updates_help', 'Update preferences for this installation.');
        case "backups": return PosnicPro.i18n.t('lang_desktop_backups', 'Backup & Recovery');
        case "backups_help": return PosnicPro.i18n.t('lang_desktop_backups_help', 'Protect the local shop database with scheduled backups.');
        case "cloudsync": return PosnicPro.i18n.t('lang_desktop_cloudsync', 'Cloud Sync');
        case "cloudsync_help": return PosnicPro.i18n.t('lang_desktop_cloudsync_help', 'Connection and synchronization for this computer.');
        case "systemstatus": return PosnicPro.i18n.t('lang_desktop_systemstatus', 'System Status');
        case "systemstatus_help": return PosnicPro.i18n.t('lang_desktop_systemstatus_help', 'Diagnostics and support when something needs attention.');
        case "kitchen": return PosnicPro.i18n.t('lang_desktop_kitchen', 'Kitchen Printing');
        case "kitchen_help": return PosnicPro.i18n.t('lang_desktop_kitchen_help', 'Automatically print tickets for the selected branch on this computer.');
        default: return fallback;
        }
    }
    function esc(value) { return PosnicPro.escapeHtml(String(value == null ? '' : value)); }
    function host(key) { return $('[data-desktop-page="' + key + '"]'); }
    function note(key, message, error) { host(key).find('[data-desktop-status]').text(message).toggleClass('text-danger', !!error); }
    function allowed() { return !!(PosnicPro.userACL && PosnicPro.userACL.branch && PosnicPro.userACL.branch.write); }
    function button(action, label, primary) { return '<button type="button" class="btn btn-' + (primary ? 'primary' : 'outline-primary') + ' btn-sm" data-desktop-action="' + action + '">' + esc(label) + '</button>'; }
    function open(target, label) { return '<button type="button" class="btn btn-outline-primary btn-sm" data-desktop-open="' + target + '">' + esc(label) + '</button>'; }
    function field(name, label, control, help) { return '<div class="form-group"><label for="desktop-' + name + '">' + esc(label) + '</label>' + control + (help ? '<small class="form-text text-muted">' + esc(help) + '</small>' : '') + '</div>'; }
    function input(name, value, type, attrs) { return '<input class="form-control" id="desktop-' + name + '" data-field="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '" ' + (attrs || '') + '>'; }
    function select(name, choices, value) { return '<select class="form-control" id="desktop-' + name + '" data-field="' + name + '">' + Object.keys(choices).map(function (key) { return '<option value="' + esc(key) + '"' + (String(value) === key ? ' selected' : '') + '>' + esc(choices[key]) + '</option>'; }).join('') + '</select>'; }
    function check(name, label, value, help) { return '<div class="desktop-setting-switch"><input type="checkbox" id="desktop-' + name + '" data-field="' + name + '"' + (value ? ' checked' : '') + '><label for="desktop-' + name + '">' + esc(label) + (help ? '<small>' + esc(help) + '</small>' : '') + '</label></div>'; }
    function value(key, name) { return host(key).find('[data-field="' + name + '"]').val(); }
    function checked(key, name) { return host(key).find('[data-field="' + name + '"]').prop('checked'); }
    function success(result) { if (result && (result.success === false || result.ok === false)) throw new Error(result.error || t('save_failed', 'Could not save. Please try again.')); return result; }
    function rows(items) { return '<dl class="desktop-status-list">' + items.map(function (row) { return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1] == null ? '—' : row[1]) + '</dd></div>'; }).join('') + '</dl>'; }
    function card(title, body) { return '<section class="desktop-settings-card"><h5>' + esc(title) + '</h5>' + body + '</section>'; }
    function printerChoices(printers, saved) {
        var choices = { '': t('receipt_default', 'Use receipt printer') };
        printers.forEach(function (p) { choices[p.name] = p.displayName || p.name; });
        if (saved && !choices[saved]) choices[saved] = saved + ' (' + t('unavailable', 'Unavailable') + ')';
        return choices;
    }
    async function content(key) {
        var data, html, printers;
        if (key === 'devices') {
            var loaded = await Promise.all([api.cashDrawer.loadConfig(), api.printer.list()]);
            data = loaded[0] || {}; printers = loaded[1] || []; states[key] = data;
            return card(t('receipts', 'Receipts and documents'), '<p>' + esc(t('print_location', 'Choose printers, paper and copies in Core Settings → Print → Printer Settings.')) + '</p>' + button('print-settings', t('printer_settings', 'Printer Settings')) + ' ' + open('hardware:receipt', t('test_printers', 'Test printers & view print history'))) +
                card(t('cash_drawer', 'Cash drawer'), '<div class="desktop-settings-grid">' + field('drawerPrinter', t('printer', 'Printer'), select('drawerPrinter', printerChoices(printers, data.printerName), data.printerName || '')) + field('drawerPin', t('drawer_pin', 'Drawer connector pin'), select('drawerPin', { '0': 'Pin 2', '1': 'Pin 5' }, data.pin || 0)) + '</div>' + check('drawerAuto', t('drawer_auto', 'Open the cash drawer after a sale'), !!data.autoOpenOnSale) + button('save-devices', t('save', 'Save settings'), true) + ' ' + open('hardware:cash', t('drawer_test', 'Test cash drawer'))) +
                card(t('other_devices', 'Other devices'), '<p>' + esc(t('device_tools_help', 'Open the device panel to connect, calibrate or test hardware. These tools also remain available from the desktop menu.')) + '</p><div class="desktop-actions">' + open('hardware:weight', t('scales', 'Weighing scale')) + open('hardware:scanner', t('scanner', 'Barcode scanner')) + open('hardware:mobile', t('mobile', 'Mobile devices')) + '</div>');
        }
        if (key === 'app') {
            data = api.desktop.getBehaviour ? await api.desktop.getBehaviour() : { supported: false }; states[key] = data;
            return card(t('startup', 'Startup'), (data.supported ? check('openAtLogin', t('start_login', 'Start Posnic when I sign in to this computer'), data.openAtLogin, t('start_background', 'Starts in the background, ready to open from the system tray.')) + button('save-app', t('save', 'Save settings'), true) : '<p>' + esc(t('os_startup', 'Manage startup applications in your operating system settings.')) + '</p>')) + card(t('background', 'Working in the background'), '<p>' + esc(t('background_help', 'Closing the main window keeps Posnic running in the system tray. Kitchen printing and synchronization continue. Use Quit Posnic to stop the app.')) + '</p>');
        }
        if (key === 'updates') {
            var result = success(await window.electron.update.getConfig()); data = result.config || {}; states[key] = data;
            return card(t('update_preferences', 'Update preferences'), check('autoCheck', t('auto_check', 'Check for updates automatically'), data.autoCheck !== false) + field('checkFrequency', t('check_frequency', 'How often'), select('checkFrequency', { daily: t('daily', 'Every day'), weekly: t('weekly', 'Every week') }, data.checkFrequency || 'daily')) + check('installOnQuit', t('install_quit', 'Install updates when I close Posnic'), data.installOnQuit !== false) + field('updateChannel', t('update_channel', 'Release channel'), select('updateChannel', { stable: t('stable', 'Stable releases'), beta: t('beta', 'Test builds') }, data.channel || 'stable'), t('channel_help', 'Use stable releases on a working till. Switching back does not undo a test build already installed; it waits for a newer stable release.')) + button('save-updates', t('save', 'Save settings'), true)) + card(t('update_recovery', 'Updates & recovery'), '<p>' + esc(t('update_recovery_help', 'Check, download or revert an update in the independent update window. You can open it from the desktop menu even when this screen is unavailable.')) + '</p>' + open('update', t('open_updates', 'Open Updates & Recovery')));
        }
        if (key === 'backups') {
            var capabilities = await api.desktop.capabilities();
            if (!capabilities.backup) return card(t('cloud_backup', 'Cloud installation'), '<p>' + esc(t('cloud_backup_help', 'Local database backup and restore are available for Community installations. Manage cloud data recovery with your cloud provider.')) + '</p>');
            var config = success(await backup.getBackupConfig()); data = config.config || {}; states[key] = data;
            return card(t('backup_schedule', 'Backup schedule'), check('backupEnabled', t('auto_backups', 'Create backups automatically'), data.enabled) + field('backupPath', t('backup_folder', 'Backup folder'), '<div class="desktop-inline-field">' + input('backupPath', data.path || '') + button('browse-backup', t('browse', 'Browse')) + '</div>') + '<div class="desktop-settings-grid">' + field('backupFrequency', t('frequency', 'Frequency'), select('backupFrequency', { hourly: t('hourly', 'Hourly'), daily: t('daily', 'Daily'), weekly: t('weekly', 'Weekly') }, data.frequency || 'daily')) + field('backupTime', t('time', 'Time'), input('backupTime', data.time || '02:00', 'time')) + field('backupDay', t('day', 'Day of week'), select('backupDay', { 0: t('sunday', 'Sunday'), 1: t('monday', 'Monday'), 2: t('tuesday', 'Tuesday'), 3: t('wednesday', 'Wednesday'), 4: t('thursday', 'Thursday'), 5: t('friday', 'Friday'), 6: t('saturday', 'Saturday') }, data.dayOfWeek || 0)) + field('backupRetention', t('retention', 'Keep backups for (days)'), input('backupRetention', data.retentionDays || 30, 'number', 'min="1" max="365"')) + '</div>' + button('save-backups', t('save', 'Save settings'), true)) + card(t('backup_restore', 'Backup & restore'), '<p>' + esc(t('restore_help', 'Restore replaces shop data. The independent recovery window shows available backups and asks you to confirm before restoring.')) + '</p><div class="desktop-actions">' + button('backup-now', t('backup_now', 'Back up now')) + open('backup', t('browse_restore', 'Browse backups & restore')) + '</div>');
        }
        if (key === 'cloudsync') {
            data = await api.cloud.status(); var sync = data.sync || {};
            return card(t('sync_status', 'Sync status'), rows([[t('connection', 'Connection'), data.connected ? t('connected', 'Connected') : t('not_connected', 'Not connected')], [t('sync', 'Sync'), !data.connected ? '—' : sync.online ? t('online', 'Online') : t('offline_retry', 'Offline / retrying')], [t('last_sync', 'Last successful sync'), sync.lastSuccessAt ? new Date(sync.lastSuccessAt).toLocaleString() : '—'], [t('pending', 'Waiting to upload'), sync.pending]]) + (sync.lastError ? '<p class="text-danger">' + esc(sync.lastError) + '</p>' : '') + '<div class="desktop-actions">' + button('refresh', t('refresh', 'Refresh status')) + open('cloud', t('manage_cloud', 'Manage cloud connection')) + '</div>');
        }
        if (key === 'systemstatus') {
            data = await api.desktop.capabilities();
            return card(t('installation', 'This installation'), rows([[t('version', 'Installed version'), data.version], [t('platform', 'Operating system'), { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[api.platform] || api.platform], [t('edition', 'Installation'), data.backup ? PosnicPro.i18n.t('lang_community', 'Community') : PosnicPro.i18n.t('lang_cloud', 'Cloud')]]) + '<div class="desktop-actions">' + open('log', t('view_logs', 'View application logs')) + open('hardware', t('hardware_diagnostics', 'Hardware diagnostics')) + open('about', t('about', 'About Posnic')) + '</div>');
        }
        if (key === 'kitchen') {
            var loadedKitchen = await Promise.all([api.kot.getConfig(), api.kot.getStatus(), api.printer.list()]);
            data = loadedKitchen[0]; var status = loadedKitchen[1]; states[key] = data;
            kitchenRunning = !!status.isPolling;
            var branches = {}; (data.branches || []).forEach(function (b) { branches[b.id] = b.name; });
            if (data.branchId && !branches[data.branchId]) branches[data.branchId] = data.branchId;
            printers = loadedKitchen[2] || [];
            var saved = data.printers || (data.printerNames || []).map(function (name) { return { name: name }; });
            var names = printers.map(function (p) { return p.name; });
            saved.forEach(function (p) { if (names.indexOf(p.name) < 0) { printers.push({ name: p.name, displayName: p.name + ' (' + t('unavailable', 'Unavailable') + ')' }); names.push(p.name); } });
            html = '<p class="desktop-worker-status" role="status">' + esc(status.isPolling ? t('kitchen_running', 'Running - tickets print as orders arrive') : t('kitchen_paused', 'Paused - automatic kitchen printing is stopped')) + '</p>' + field('kitchenBranch', t('branch', 'Branch'), select('kitchenBranch', branches, data.branchId)) + '<div class="desktop-kitchen-printers">' + printers.map(function (printer, i) {
                var selected = saved.find(function (p) { return p.name === printer.name; });
                return '<div class="desktop-kitchen-printer" data-kitchen-printer="' + esc(printer.name) + '">' + check('kitchenPrinter' + i, printer.displayName || printer.name, !!selected) + field('kitchenPaper' + i, t('paper', 'Paper'), select('kitchenPaper' + i, Object.assign({ '80mm': '80 mm', '58mm': '58 mm', a4: 'A4', a5: 'A5', letter: 'US Letter' }, selected && selected.pageSize ? { [selected.pageSize]: selected.pageSize } : {}), selected && selected.pageSize || '80mm')) + field('kitchenCopies' + i, t('copies', 'Copies'), input('kitchenCopies' + i, selected && selected.copies || 1, 'number', 'min="1" max="20"')) + '</div>';
            }).join('') + '</div><p class="text-muted">' + esc(t('kitchen_pause_help', 'Pause finishes any ticket already being sent. The pause is remembered after restarting; opening settings never resumes printing.')) + '</p><div class="desktop-actions">' + button('save-kitchen', t('kitchen_start', 'Save & resume printing'), true) + button('pause-kitchen', t('kitchen_pause', 'Pause printing')) + button('refresh', t('refresh', 'Refresh status')) + open('hardware:kot', t('print_history', 'Print history & diagnostics')) + '</div>';
            return card(t('kitchen_worker', 'Automatic kitchen printing'), html) + card(t('kitchen_devices', 'Kitchen devices'), '<div class="desktop-actions">' + open('hardware:screen', t('kitchen_screen', 'Kitchen screen')) + open('hardware:sound', t('kitchen_sound', 'Kitchen sound')) + '</div>');
        }
        return '';
    }
    async function load(key) {
        if (!sections[key] || !host(key).length) return;
        var stamp = revision[key] = (revision[key] || 0) + 1;
        if (!api || !api.desktop) { host(key).html('<p class="text-muted">' + esc(t('desktop_only', 'Open Posnic on this computer to manage connected devices and desktop settings.')) + '</p>'); return; }
        if (!allowed()) { host(key).html('<p>' + esc(t('permission', 'An administrator must open these settings.')) + '</p>'); return; }
        host(key).html('<p role="status">' + esc(t('loading', 'Loading settings…')) + '</p>');
        try {
            var body = await content(key);
            if (revision[key] !== stamp) return;
            host(key).html('<div class="desktop-page-heading"><div><h4>' + esc(t(key, sections[key][0])) + '</h4><p>' + esc(t(key + '_help', sections[key][1])) + '</p></div><span class="badge badge-light">' + esc(t('this_computer', 'This computer')) + '</span></div>' + body + '<p data-desktop-status role="status" aria-live="polite"></p>');
            frequency(key);
            if (key === 'kitchen') host(key).find('input,select,[data-desktop-action="save-kitchen"]').prop('disabled', kitchenRunning);
        } catch (error) { host(key).html('<p role="alert">' + esc(error.message) + '</p>' + button('refresh', t('retry', 'Try again'))); }
    }
    function frequency(key) {
        if (key === 'backups') {
            host(key).find('[data-field="backupTime"]').closest('.form-group').toggle(value(key, 'backupFrequency') !== 'hourly');
            host(key).find('[data-field="backupDay"]').closest('.form-group').toggle(value(key, 'backupFrequency') === 'weekly');
        }
        if (key === 'updates') host(key).find('[data-field="checkFrequency"]').prop('disabled', !checked(key, 'autoCheck'));
    }
    async function action(key, name) {
        if (!allowed()) throw new Error(t('permission', 'An administrator must open these settings.'));
        if (name === 'refresh') return load(key);
        if (name === 'print-settings') { PosnicPro.settings.openSection('general'); $('#core_settings_tabs a[href="#core-tab-print"]').tab('show'); $('#print-printers-tab').tab('show'); return; }
        if (name === 'browse-backup') { var folder = await backup.browseBackupFolder(); if (folder) host(key).find('[data-field="backupPath"]').val(folder); return; }
        if (name === 'save-app') success(await api.desktop.saveBehaviour({ openAtLogin: checked(key, 'openAtLogin') }));
        if (name === 'save-devices') {
            var previous = states[key], printerName = value(key, 'drawerPrinter');
            var method = printerName === (previous.printerName || '') ? (previous.method || 'printer') : 'printer';
            var drawer = Object.assign({}, previous, { printerName: printerName, pin: Number(value(key, 'drawerPin')), autoOpenOnSale: checked(key, 'drawerAuto'), method: method });
            success(await api.cashDrawer.saveConfig(drawer)); states[key] = drawer;
        }
        if (name === 'save-updates') success(await window.electron.update.saveConfig({ autoCheck: checked(key, 'autoCheck'), checkFrequency: value(key, 'checkFrequency'), installOnQuit: checked(key, 'installOnQuit'), channel: value(key, 'updateChannel') }));
        if (name === 'save-backups') {
            var cfg = { enabled: checked(key, 'backupEnabled'), path: value(key, 'backupPath').trim(), frequency: value(key, 'backupFrequency'), time: value(key, 'backupTime'), dayOfWeek: Number(value(key, 'backupDay')), retentionDays: Number(value(key, 'backupRetention')) };
            if (cfg.enabled && !cfg.path) throw new Error(t('folder_required', 'Choose a backup folder.'));
            if (!Number.isInteger(cfg.retentionDays) || cfg.retentionDays < 1 || cfg.retentionDays > 365) throw new Error(t('retention_invalid', 'Choose between 1 and 365 days.'));
            if (!/^\d{2}:\d{2}$/.test(cfg.time)) throw new Error(t('time_required', 'Choose a backup time.'));
            success(await backup.saveBackupConfig(cfg));
        }
        if (name === 'backup-now') { success(await backup.runBackupNow(false)); note(key, t('backup_complete', 'Backup completed. Open Browse backups & restore to view it.')); return; }
        if (name === 'pause-kitchen') { success(await api.kot.stopPolling()); return load(key); }
        if (name === 'save-kitchen') {
            // A second window may have resumed the worker since this page loaded.
            // Pause before replacing destinations used by a running print pass.
            if ((await api.kot.getStatus()).isPolling) return load(key);
            var selected = [];
            host(key).find('[data-kitchen-printer]').each(function (i) {
                if (!checked(key, 'kitchenPrinter' + i)) return;
                var name = $(this).attr('data-kitchen-printer'), copies = Number(value(key, 'kitchenCopies' + i));
                if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw new Error(t('copies_invalid', 'Choose between 1 and 20 copies.'));
                var old = (states[key].printers || []).find(function (p) { return p.name === name; }) || {};
                selected.push(Object.assign({}, old, { name: name, copies: copies, pageSize: value(key, 'kitchenPaper' + i) }));
            });
            if (!value(key, 'kitchenBranch') || !selected.length) throw new Error(t('kitchen_required', 'Choose a branch and at least one kitchen printer.'));
            var next = Object.assign({}, states[key], { branchId: value(key, 'kitchenBranch'), printers: selected, printerNames: selected.map(function (p) { return p.name; }) });
            delete next.branches;
            success(await api.kot.startPolling(next)); return load(key);
        }
        note(key, t('saved', 'Settings saved.'));
    }
    $(document).on('click.desktopSettings', '[data-desktop-action]', async function () {
        var key = $(this).closest('[data-desktop-page]').attr('data-desktop-page'), el = $(this);
        el.prop('disabled', true); note(key, t('working', 'Working…'));
        try { await action(key, el.attr('data-desktop-action')); } catch (error) { note(key, error.message, true); }
        finally { el.prop('disabled', false); }
    }).on('click.desktopSettings', '[data-desktop-open]', async function () {
        var key = $(this).closest('[data-desktop-page]').attr('data-desktop-page');
        try { if (!allowed()) throw new Error(t('permission', 'An administrator must open these settings.')); await api.desktop.open($(this).attr('data-desktop-open')); }
        catch (error) { note(key, error.message, true); }
    }).on('change.desktopSettings', '[data-desktop-page] input, [data-desktop-page] select', function () {
        var key = $(this).closest('[data-desktop-page]').attr('data-desktop-page'); frequency(key); note(key, t('unsaved', 'Unsaved changes'));
    }).on('shown.bs.tab.desktopSettings', '#restaurantprinting-tab-line', function () { load('kitchen'); });
    $(function () {
        $('[data-desktop-only]').toggle(!!(api && api.desktop));
        if (api && api.desktop && api.desktop.onNavigate) api.desktop.onNavigate(function (section) {
            if (sections[section] && section !== 'kitchen') hasher.setHash('settings/' + section);
        });
    });
    PosnicPro.desktopSettings = { load: load };
}());

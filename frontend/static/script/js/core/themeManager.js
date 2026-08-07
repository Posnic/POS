/**
 * PosnicPro Theme Manager
 * Handles theme customization with local storage and API sync
 */
PosnicPro.themeManager = {
    tokenMap: {
        primaryColor: { cssVar: '--theme-primary-color' },
        bodyBg: { cssVar: '--theme-body-bg' },
        cardBg: { cssVar: '--theme-card-bg' },
        sidebarBg: { cssVar: '--theme-sidebar-bg' },
        topbarBg: { cssVar: '--theme-topbar-bg' },
        textPrimary: { cssVar: '--theme-text-primary' },
        textSecondary: { cssVar: '--theme-text-secondary' },
        borderColor: { cssVar: '--theme-border-color' },
        menuBg: { cssVar: '--theme-menu-bg' },
        menuText: { cssVar: '--theme-menu-text' },
        menuActiveBg: { cssVar: '--theme-menu-active-bg' },
        menuActiveText: { cssVar: '--theme-menu-active-text' },
        fontFamily: { cssVar: '--theme-font-family' },
        fontSize: { cssVar: '--theme-font-size-base', unit: 'px' },
        fontWeight: { cssVar: '--theme-font-weight' }
    },

    defaults: {
        preset: 'default',
        primaryColor: '#4e6ddf',
        bodyBg: '#f2f3f7',
        cardBg: '#ffffff',
        sidebarBg: '#ffffff',
        topbarBg: '#ffffff',
        textPrimary: '#000000',
        textSecondary: '#333333',
        fontFamily: "'Mukta Vaani', sans-serif",
        fontSize: '16',
        fontWeight: '300',
        borderColor: '#e6e6e6',
        menuBg: '#ffffff',
        menuText: '#333333',
        menuActiveBg: '#4e6ddf',
        menuActiveText: '#ffffff'
    },

    presets: {
        // Light Themes
        default: {
            name: 'Default',
            type: 'light',
            primaryColor: '#4e6ddf',
            bodyBg: '#f2f3f7',
            cardBg: '#ffffff',
            sidebarBg: '#ffffff',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#ffffff',
            menuText: '#333333',
            menuActiveBg: '#4e6ddf',
            menuActiveText: '#ffffff'
        },
        blue: {
            name: 'Blue',
            type: 'light',
            primaryColor: '#2196F3',
            bodyBg: '#e3f2fd',
            cardBg: '#ffffff',
            sidebarBg: '#1565C0',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#1565C0',
            menuText: '#ffffff',
            menuActiveBg: '#0D47A1',
            menuActiveText: '#ffffff'
        },
        green: {
            name: 'Green',
            type: 'light',
            primaryColor: '#4CAF50',
            bodyBg: '#E8F5E9',
            cardBg: '#ffffff',
            sidebarBg: '#2E7D32',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#2E7D32',
            menuText: '#ffffff',
            menuActiveBg: '#1B5E20',
            menuActiveText: '#ffffff'
        },
        purple: {
            name: 'Purple',
            type: 'light',
            primaryColor: '#9C27B0',
            bodyBg: '#F3E5F5',
            cardBg: '#ffffff',
            sidebarBg: '#6A1B9A',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#6A1B9A',
            menuText: '#ffffff',
            menuActiveBg: '#4A148C',
            menuActiveText: '#ffffff'
        },
        orange: {
            name: 'Orange',
            type: 'light',
            primaryColor: '#FF9800',
            bodyBg: '#FFF3E0',
            cardBg: '#ffffff',
            sidebarBg: '#ca4700',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#ca4700',
            menuText: '#ffffff',
            menuActiveBg: '#BF360C',
            menuActiveText: '#ffffff'
        },
        teal: {
            name: 'Teal',
            type: 'light',
            primaryColor: '#009688',
            bodyBg: '#E0F2F1',
            cardBg: '#ffffff',
            sidebarBg: '#00695C',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#00695C',
            menuText: '#ffffff',
            menuActiveBg: '#004D40',
            menuActiveText: '#ffffff'
        },
        pink: {
            name: 'Pink',
            type: 'light',
            primaryColor: '#E91E63',
            bodyBg: '#FCE4EC',
            cardBg: '#ffffff',
            sidebarBg: '#AD1457',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#AD1457',
            menuText: '#ffffff',
            menuActiveBg: '#880E4F',
            menuActiveText: '#ffffff'
        },
        amber: {
            name: 'Amber',
            type: 'light',
            primaryColor: '#FFC107',
            bodyBg: '#FFF8E1',
            cardBg: '#ffffff',
            sidebarBg: '#FF8F00',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#FF8F00',
            menuText: '#212121',
            menuActiveBg: '#FF6F00',
            menuActiveText: '#212121'
        },
        indigo: {
            name: 'Indigo',
            type: 'light',
            primaryColor: '#3F51B5',
            bodyBg: '#E8EAF6',
            cardBg: '#ffffff',
            sidebarBg: '#283593',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#283593',
            menuText: '#ffffff',
            menuActiveBg: '#1A237E',
            menuActiveText: '#ffffff'
        },
        lime: {
            name: 'Lime',
            type: 'light',
            primaryColor: '#CDDC39',
            bodyBg: '#F9FBE7',
            cardBg: '#ffffff',
            sidebarBg: '#9E9D24',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#9E9D24',
            menuText: '#212121',
            menuActiveBg: '#827717',
            menuActiveText: '#ffffff'
        },
        cyan: {
            name: 'Cyan',
            type: 'light',
            primaryColor: '#00BCD4',
            bodyBg: '#E0F7FA',
            cardBg: '#ffffff',
            sidebarBg: '#00838F',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#00838F',
            menuText: '#ffffff',
            menuActiveBg: '#006064',
            menuActiveText: '#ffffff'
        },
        brown: {
            name: 'Coffee',
            type: 'light',
            primaryColor: '#795548',
            bodyBg: '#EFEBE9',
            cardBg: '#ffffff',
            sidebarBg: '#5D4037',
            topbarBg: '#ffffff',
            textPrimary: '#000000',
            textSecondary: '#333333',
            menuBg: '#5D4037',
            menuText: '#ffffff',
            menuActiveBg: '#4E342E',
            menuActiveText: '#ffffff'
        },
        // Dark Themes
        dark: {
            name: 'Dark (VS Code)',
            type: 'dark',
            primaryColor: '#569cd6',
            bodyBg: '#1e1e1e',
            cardBg: '#252526',
            sidebarBg: '#252526',
            topbarBg: '#323233',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#252526',
            menuText: '#e0e0e0',
            menuActiveBg: '#37373d',
            menuActiveText: '#ffffff'
        },
        nord: {
            name: 'Nord',
            type: 'dark',
            primaryColor: '#88c0d0',
            bodyBg: '#2e3440',
            cardBg: '#3b4252',
            sidebarBg: '#2e3440',
            topbarBg: '#3b4252',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#2e3440',
            menuText: '#e0e0e0',
            menuActiveBg: '#434c5e',
            menuActiveText: '#ffffff'
        },
        monokai: {
            name: 'Monokai',
            type: 'dark',
            primaryColor: '#66d9ef',
            bodyBg: '#272822',
            cardBg: '#3e3d32',
            sidebarBg: '#272822',
            topbarBg: '#3e3d32',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#272822',
            menuText: '#e0e0e0',
            menuActiveBg: '#49483e',
            menuActiveText: '#ffffff'
        },
        ocean: {
            name: 'Ocean',
            type: 'dark',
            primaryColor: '#00bcd4',
            bodyBg: '#0a1929',
            cardBg: '#0d2137',
            sidebarBg: '#071318',
            topbarBg: '#0d2137',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#071318',
            menuText: '#e0e0e0',
            menuActiveBg: '#132f4c',
            menuActiveText: '#e3f2fd'
        },
        sunset: {
            name: 'Sunset',
            type: 'dark',
            primaryColor: '#ff7043',
            bodyBg: '#1a1a2e',
            cardBg: '#16213e',
            sidebarBg: '#0f0f1a',
            topbarBg: '#16213e',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#0f0f1a',
            menuText: '#e0e0e0',
            menuActiveBg: '#1f2b47',
            menuActiveText: '#ffffff'
        },
        midnight: {
            name: 'Midnight (AMOLED)',
            type: 'dark',
            primaryColor: '#bb86fc',
            bodyBg: '#000000',
            cardBg: '#121212',
            sidebarBg: '#000000',
            topbarBg: '#121212',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#000000',
            menuText: '#e0e0e0',
            menuActiveBg: '#1e1e1e',
            menuActiveText: '#ffffff'
        },
        dracula: {
            name: 'Dracula',
            type: 'dark',
            primaryColor: '#bd93f9',
            bodyBg: '#282a36',
            cardBg: '#44475a',
            sidebarBg: '#21222c',
            topbarBg: '#44475a',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#21222c',
            menuText: '#e0e0e0',
            menuActiveBg: '#44475a',
            menuActiveText: '#ffffff'
        },
        solarized: {
            name: 'Solarized',
            type: 'dark',
            primaryColor: '#268bd2',
            bodyBg: '#002b36',
            cardBg: '#073642',
            sidebarBg: '#002b36',
            topbarBg: '#073642',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#002b36',
            menuText: '#e0e0e0',
            menuActiveBg: '#073642',
            menuActiveText: '#fdf6e3'
        },
        gruvbox: {
            name: 'Gruvbox',
            type: 'dark',
            primaryColor: '#fe8019',
            bodyBg: '#282828',
            cardBg: '#3c3836',
            sidebarBg: '#1d2021',
            topbarBg: '#3c3836',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#1d2021',
            menuText: '#e0e0e0',
            menuActiveBg: '#3c3836',
            menuActiveText: '#ebdbb2'
        },
        onedark: {
            name: 'One Dark',
            type: 'dark',
            primaryColor: '#61afef',
            bodyBg: '#282c34',
            cardBg: '#21252b',
            sidebarBg: '#21252b',
            topbarBg: '#21252b',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#21252b',
            menuText: '#e0e0e0',
            menuActiveBg: '#3e4451',
            menuActiveText: '#ffffff'
        },
        material: {
            name: 'Material',
            type: 'dark',
            primaryColor: '#03dac6',
            bodyBg: '#121212',
            cardBg: '#1e1e1e',
            sidebarBg: '#1e1e1e',
            topbarBg: '#1e1e1e',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#1e1e1e',
            menuText: '#e0e0e0',
            menuActiveBg: '#2c2c2c',
            menuActiveText: '#e1e1e1'
        },
        forest: {
            name: 'Forest',
            type: 'dark',
            primaryColor: '#4caf50',
            bodyBg: '#1b2b1b',
            cardBg: '#263526',
            sidebarBg: '#1b2b1b',
            topbarBg: '#263526',
            textPrimary: '#ffffff',
            textSecondary: '#e0e0e0',
            menuBg: '#1b2b1b',
            menuText: '#e0e0e0',
            menuActiveBg: '#2e4a2e',
            menuActiveText: '#c8e6c9'
        }
    },

    isApplyingPreset: false,

    init: function() {
        var self = this;
        var savedTheme = this.getFromLocal();
        if (savedTheme) {
            this.applyTheme(savedTheme);
        } else {
            // No localStorage, try to fetch from server
            this.loadFromServer();
        }

        this.initStorageSync();
    },

    initStorageSync: function() {
        var self = this;
        if (this._storageSyncInitialized) return;
        this._storageSyncInitialized = true;

        window.addEventListener('storage', function(e) {
            if (!e || e.key !== 'posnic_theme_settings') return;

            var newSettings = null;
            try {
                newSettings = e.newValue ? JSON.parse(e.newValue) : null;
            } catch (err) {
                return;
            }

            if (newSettings) {
                self.applyTheme(newSettings);
            } else {
                self.resetToDefault();
            }
        });
    },

    loadFromServer: function() {
        var self = this;
        var params = {
            url: 'setting/getThemeSettings'
        };
        PosnicPro.get(params, function(response) {
            if (response.type === 'success' && response.data && response.data.theme_settings) {
                var settings = response.data.theme_settings;
                var state = self.toThemeState(settings);
                self.applyTheme(state);
                self.saveToLocal(state);
            }
        }, function(xhr) {
            // Silently fail, use defaults
            console.log('Could not load theme from server, using defaults');
        });
    },

    getFromLocal: function() {
        try {
            var theme = localStorage.getItem('posnic_theme_settings');
            return theme ? JSON.parse(theme) : null;
        } catch (e) {
            console.error('Error reading theme from localStorage:', e);
            return null;
        }
    },

    saveToLocal: function(settings) {
        try {
            localStorage.setItem('posnic_theme_settings', JSON.stringify(settings));
            return true;
        } catch (e) {
            console.error('Error saving theme to localStorage:', e);
            return false;
        }
    },

    toThemeState: function(settings) {
        if (!settings) return { preset: this.defaults.preset, overrides: {} };

        if (settings.overrides && typeof settings.overrides === 'object') {
            return {
                preset: settings.preset || this.defaults.preset,
                overrides: Object.assign({}, settings.overrides)
            };
        }

        var preset = settings.preset || this.defaults.preset;

        var overrides = {};
        var keys = Object.keys(this.tokenMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (typeof settings[key] !== 'undefined' && settings[key] !== null && settings[key] !== '') {
                overrides[key] = settings[key];
            }
        }

        return { preset: preset, overrides: overrides };
    },

    normalizeThemeState: function(state) {
        var s = this.toThemeState(state);
        var merged = Object.assign({}, this.defaults, s.overrides, { preset: s.preset });
        merged = this.normalizeSettings(merged);

        var overrides = {};
        var keys = Object.keys(this.tokenMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (typeof s.overrides[key] !== 'undefined') {
                overrides[key] = merged[key];
            }
        }

        return { preset: merged.preset, overrides: overrides };
    },

    applyOverrides: function(overrides) {
        var root = document.documentElement;
        if (!overrides) return;

        var keys = Object.keys(this.tokenMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (typeof overrides[key] === 'undefined' || overrides[key] === null) continue;

            var cfg = this.tokenMap[key];
            var val = overrides[key];
            if (cfg.unit) {
                val = '' + val;
                if (val.indexOf(cfg.unit) === -1) {
                    val = val + cfg.unit;
                }
            }
            root.style.setProperty(cfg.cssVar, val);
        }
    },

    themeStateToServerSettings: function(state) {
        var ui = this.hydrateForUi(state);
        return {
            preset: ui.preset,
            primaryColor: ui.primaryColor,
            bodyBg: ui.bodyBg,
            cardBg: ui.cardBg,
            sidebarBg: ui.sidebarBg,
            topbarBg: ui.topbarBg,
            textPrimary: ui.textPrimary,
            textSecondary: ui.textSecondary,
            fontFamily: ui.fontFamily,
            fontSize: ui.fontSize,
            fontWeight: ui.fontWeight,
            borderColor: ui.borderColor,
            menuBg: ui.menuBg,
            menuText: ui.menuText,
            menuActiveBg: ui.menuActiveBg,
            menuActiveText: ui.menuActiveText
        };
    },

    normalizeSettings: function(settings) {
        var s = Object.assign({}, this.defaults, settings || {});

        var hex = function(val) {
            if (typeof val !== 'string') return null;
            var v = val.trim();
            if (/^#[0-9a-fA-F]{3}$/.test(v)) return v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
            return null;
        };

        var clampInt = function(val, min, max, fallback) {
            var n = parseInt(val, 10);
            if (isNaN(n)) return fallback;
            if (n < min) return min;
            if (n > max) return max;
            return n;
        };

        var safeStr = function(val, fallback) {
            return (typeof val === 'string' && val.trim() !== '') ? val : fallback;
        };

        s.preset = safeStr(s.preset, this.defaults.preset);

        s.primaryColor = hex(s.primaryColor) || this.defaults.primaryColor;
        s.bodyBg = hex(s.bodyBg) || this.defaults.bodyBg;
        s.cardBg = hex(s.cardBg) || this.defaults.cardBg;
        s.sidebarBg = hex(s.sidebarBg) || this.defaults.sidebarBg;
        s.topbarBg = hex(s.topbarBg) || this.defaults.topbarBg;
        s.textPrimary = hex(s.textPrimary) || this.defaults.textPrimary;
        s.textSecondary = hex(s.textSecondary) || this.defaults.textSecondary;
        s.borderColor = hex(s.borderColor) || this.defaults.borderColor;
        s.menuBg = hex(s.menuBg) || this.defaults.menuBg;
        s.menuText = hex(s.menuText) || this.defaults.menuText;
        s.menuActiveBg = hex(s.menuActiveBg) || this.defaults.menuActiveBg;
        s.menuActiveText = hex(s.menuActiveText) || this.defaults.menuActiveText;

        s.fontFamily = safeStr(s.fontFamily, this.defaults.fontFamily);
        s.fontWeight = safeStr(s.fontWeight, this.defaults.fontWeight);
        s.fontSize = '' + clampInt(s.fontSize, 12, 22, parseInt(this.defaults.fontSize, 10));

        return s;
    },

    clearInlineThemeVariables: function() {
        var root = document.documentElement;
        var keys = Object.keys(this.tokenMap);
        for (var i = 0; i < keys.length; i++) {
            var cfg = this.tokenMap[keys[i]];
            root.style.removeProperty(cfg.cssVar);
        }
    },

    hydrateForUi: function(settings) {
        var state = this.normalizeThemeState(settings);
        var presetName = state.preset;
        var base;

        if (presetName && presetName !== 'custom' && this.presets[presetName]) {
            base = Object.assign({}, this.defaults, this.presets[presetName], { preset: presetName });
        } else {
            base = Object.assign({}, this.defaults, { preset: 'custom' });
        }

        return Object.assign({}, base, state.overrides);
    },

    /*
     * The colours the window frame should wear, for the theme just applied.
     *
     * Reads the resolved values rather than the saved ones: a shop on a preset
     * has no overrides to read, and a shop that has changed one colour needs
     * that change and the preset's other colours together.
     */
    resolveChrome: function(state) {
        /*
         * Ask the page what colour it actually is.
         *
         * This used to read the preset table in this file, while the title bar
         * itself is painted by a CSS variable from the stylesheet - two records
         * of the same colour, which is one too many. They agree today; the
         * first time somebody edits a preset in one place and not the other,
         * the window controls and the bar they sit in stop matching, and the
         * seam is visible on every screen in every shop.
         *
         * The computed style is the colour on the glass, so there is nothing
         * left to disagree with it. The table below is only the fallback for a
         * page that has not finished applying its stylesheet yet.
         */
        var preset = (state.preset && this.presets[state.preset]) || this.presets.default || {};
        var o = state.overrides || {};
        var fallback = {
            topbarBg: o.topbarBg || preset.topbarBg || this.defaults.topbarBg,
            bodyBg: o.bodyBg || preset.bodyBg || this.defaults.bodyBg,
            textPrimary: o.textPrimary || preset.textPrimary || this.defaults.textPrimary,
        };

        try {
            var computed = window.getComputedStyle(document.documentElement);
            var read = function (name, orElse) {
                var value = (computed.getPropertyValue(name) || '').trim();
                return /^#[0-9a-f]{3,8}$/i.test(value) ? value : orElse;
            };
            /*
             * The whole palette, not only the three the title bar needs.
             *
             * Hardware Manager, the Cloud panel, Backup and Software Update are
             * separate Electron windows with their own stylesheets and no sight
             * of this page's CSS. They were written with fixed blue gradients,
             * so a shop on a dark theme opens Hardware Manager and finds a
             * different product looking back. Sending the palette lets them
             * dress themselves - see window-theme.js.
             */
            return {
                topbarBg: read('--theme-topbar-bg', fallback.topbarBg),
                bodyBg: read('--theme-body-bg', fallback.bodyBg),
                textPrimary: read('--theme-text-primary', fallback.textPrimary),
                cardBg: read('--theme-card-bg', '#ffffff'),
                sidebarBg: read('--theme-sidebar-bg', fallback.topbarBg),
                textSecondary: read('--theme-text-secondary', '#6b7280'),
                borderColor: read('--theme-border-color', '#e6e6e6'),
                primaryColor: read('--theme-primary-color', '#4e6ddf'),
            };
        } catch (e) {
            return fallback;
        }
    },

    /*
     * Hand them to the window frame, on the desktop only.
     *
     * Silent everywhere else: a browser has no frame to colour, and a failure
     * here must never be the reason a theme does not apply.
     */
    syncWindowChrome: function(state) {
        try {
            if (!window.electronAPI || !window.electronAPI.theme) return;
            window.electronAPI.theme.setChrome(this.resolveChrome(state));
        } catch (e) { /* the page is themed either way */ }
    },

    applyTheme: function(settings) {
        var root = document.documentElement;
        var state = this.normalizeThemeState(settings);

        if (state.preset && state.preset !== 'custom' && this.presets[state.preset]) {
            if (state.preset === 'default') {
                root.removeAttribute('data-theme');
                document.body.removeAttribute('data-theme');
            } else {
                root.setAttribute('data-theme', state.preset);
                document.body.setAttribute('data-theme', state.preset);
            }
            this.clearInlineThemeVariables();
            this.applyOverrides(state.overrides);
            this.syncWindowChrome(state);
            return;
        }

        root.removeAttribute('data-theme');
        document.body.removeAttribute('data-theme');
        this.clearInlineThemeVariables();
        this.applyOverrides(state.overrides);
        this.syncWindowChrome(state);
    },

    applyPreset: function(presetName) {
        var preset = this.presets[presetName];
        if (preset) {
            var self = this;

            // Set flag to prevent colorpicker events from interfering
            this.isApplyingPreset = true;

            var state = { preset: presetName, overrides: {} };
            this.applyTheme(state);
            this.saveToLocal(state);

            // Update form fields without triggering events
            this.updateFormFieldsSilent(this.hydrateForUi(state));

            // Re-enable colorpicker events after a delay
            setTimeout(function() {
                self.isApplyingPreset = false;
                self.initColorPickers();
            }, 100);

            return this.hydrateForUi(state);
        }
        return null;
    },

    reinitColorPickers: function() {
        var self = this;
        $('.theme-color-input').each(function() {
            var $input = $(this);
            var inputId = $input.attr('id');
            var previewId = inputId + '_preview';
            var currentVal = $input.val();

            // Update preview color
            $('#' + previewId).css('background-color', currentVal);

            // If colorpicker is initialized, update it
            if ($input.data('colorpicker')) {
                $input.colorpicker('setValue', currentVal);
            }
        });
    },

    getCurrentSettings: function() {
        var saved = this.getFromLocal();
        if (saved) return saved;
        return { preset: this.defaults.preset, overrides: {} };
    },

    updateFormFields: function(settings) {
        this.updateFormFieldsSilent(settings);
    },

    updateFormFieldsSilent: function(settings) {
        var fontSize = settings.fontSize || this.defaults.fontSize;
        var fontFamily = settings.fontFamily || this.defaults.fontFamily;
        var fontWeight = settings.fontWeight || this.defaults.fontWeight;

        // Destroy colorpickers temporarily to prevent events
        $('.theme-color-input').each(function() {
            var $input = $(this);
            if ($input.data('colorpicker')) {
                $input.colorpicker('destroy');
            }
        });

        if ($('#theme_primary_color').length) {
            $('#theme_primary_color').val(settings.primaryColor || this.defaults.primaryColor);
            $('#theme_primary_color_preview').css('background-color', settings.primaryColor || this.defaults.primaryColor);
        }
        if ($('#theme_body_bg').length) {
            $('#theme_body_bg').val(settings.bodyBg || this.defaults.bodyBg);
            $('#theme_body_bg_preview').css('background-color', settings.bodyBg || this.defaults.bodyBg);
        }
        if ($('#theme_card_bg').length) {
            $('#theme_card_bg').val(settings.cardBg || this.defaults.cardBg);
            $('#theme_card_bg_preview').css('background-color', settings.cardBg || this.defaults.cardBg);
        }
        if ($('#theme_sidebar_bg').length) {
            $('#theme_sidebar_bg').val(settings.sidebarBg || this.defaults.sidebarBg);
            $('#theme_sidebar_bg_preview').css('background-color', settings.sidebarBg || this.defaults.sidebarBg);
        }
        if ($('#theme_text_primary').length) {
            $('#theme_text_primary').val(settings.textPrimary || this.defaults.textPrimary);
            $('#theme_text_primary_preview').css('background-color', settings.textPrimary || this.defaults.textPrimary);
        }
        if ($('#theme_text_secondary').length) {
            $('#theme_text_secondary').val(settings.textSecondary || this.defaults.textSecondary);
            $('#theme_text_secondary_preview').css('background-color', settings.textSecondary || this.defaults.textSecondary);
        }
        if ($('#theme_font_size').length) {
            $('#theme_font_size').val(fontSize);
            $('#theme_font_size_value').text(fontSize + 'px');
        }
        if ($('#theme_font_family').length) {
            $('#theme_font_family').val(fontFamily);
        }
        if ($('#theme_font_weight').length) {
            $('#theme_font_weight').val(fontWeight);
        }

        $('.theme-preset-card').removeClass('active');
        if (settings.preset) {
            $('.theme-preset-card[data-preset="' + settings.preset + '"]').addClass('active');
        }
    },

    saveSettings: function(callback) {
        var state = this.getFormSettings();
        this.applyTheme(state);
        this.saveToLocal(state);

        var serverSettings = this.themeStateToServerSettings(state);

        var params = {
            url: 'setting/updateThemeSettings',
            data: JSON.stringify({ theme_settings: serverSettings })
        };

        PosnicPro.put(params, function(response) {
            if (response.type === 'success') {
                PosnicPro.alert('success', 'Theme settings saved successfully');
                if (callback) callback(true, response);
            } else {
                PosnicPro.alert('error', response.message || 'Failed to save theme settings');
                if (callback) callback(false, response);
            }
        }, function(xhr) {
            var response = xhr.responseText ? JSON.parse(xhr.responseText) : { message: 'Network error' };
            PosnicPro.alert('error', response.message || 'Failed to save theme settings');
            if (callback) callback(false, response);
        });
    },

    resetToDefault: function() {
        var state = { preset: this.defaults.preset, overrides: {} };
        this.applyTheme(state);
        this.saveToLocal(state);
        this.updateFormFields(this.hydrateForUi(state));
        document.documentElement.removeAttribute('data-theme');
        document.body.removeAttribute('data-theme');

        this.clearInlineThemeVariables();

        var self = this;
        setTimeout(function() {
            self.initColorPickers();
        }, 100);

        PosnicPro.alert('success', 'Theme reset to default');
    },

    initColorPickers: function() {
        var self = this;

        $('.theme-color-input').each(function() {
            var $input = $(this);
            var inputId = $input.attr('id');
            var previewId = inputId + '_preview';

            // Destroy existing colorpicker if any
            if ($input.data('colorpicker')) {
                $input.colorpicker('destroy');
            }

            $input.colorpicker({
                format: 'hex',
                useAlpha: false
            }).on('colorpickerChange', function(e) {
                // Skip if we're applying a preset
                if (self.isApplyingPreset) return;

                $('#' + previewId).css('background-color', e.color.toString());
                var settings = self.getFormSettings();
                self.applyTheme(settings);
                self.saveToLocal(settings);
            });

            // Set initial preview color
            $('#' + previewId).css('background-color', $input.val());
        });
    },

    getFormSettings: function() {
        // Preserve current preset if one is active
        var currentPreset = $('.theme-preset-card.active').data('preset') || 'custom';

        var overrides = {
            primaryColor: $('#theme_primary_color').val() || this.defaults.primaryColor,
            bodyBg: $('#theme_body_bg').val() || this.defaults.bodyBg,
            cardBg: $('#theme_card_bg').val() || this.defaults.cardBg,
            sidebarBg: $('#theme_sidebar_bg').val() || this.defaults.sidebarBg,
            topbarBg: $('#theme_topbar_bg').val() || $('#theme_card_bg').val() || this.defaults.topbarBg,
            textPrimary: $('#theme_text_primary').val() || this.defaults.textPrimary,
            textSecondary: $('#theme_text_secondary').val() || this.defaults.textSecondary,
            fontFamily: $('#theme_font_family').val() || this.defaults.fontFamily,
            fontSize: $('#theme_font_size').val() || this.defaults.fontSize,
            fontWeight: $('#theme_font_weight').val() || this.defaults.fontWeight,
            borderColor: $('#theme_border_color').val() || this.defaults.borderColor,
            menuBg: $('#theme_sidebar_bg').val() || this.defaults.menuBg,
            menuText: $('#theme_menu_text').val() || this.defaults.menuText,
            menuActiveBg: $('#theme_primary_color').val() || this.defaults.menuActiveBg,
            menuActiveText: '#ffffff'
        };

        // If a preset is active, only keep values that differ from the preset's hydrated values
        if (currentPreset && currentPreset !== 'custom' && this.presets[currentPreset]) {
            var baseUi = this.hydrateForUi({ preset: currentPreset, overrides: {} });
            var keys = Object.keys(this.tokenMap);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (typeof overrides[key] === 'undefined') continue;
                if ('' + overrides[key] === '' + baseUi[key]) {
                    delete overrides[key];
                }
            }
        }

        return this.normalizeThemeState({ preset: currentPreset, overrides: overrides });
    },

    loadThemeSettingsUI: function() {
        var self = this;
        var settings = this.hydrateForUi(this.getCurrentSettings());
        
        this.updateFormFields(settings);
        
        setTimeout(function() {
            self.initColorPickers();
        }, 100);

        $('#theme_font_size').off('input').on('input', function() {
            var val = $(this).val();
            $('#theme_font_size_value').text(val + 'px');
            var settings = self.getFormSettings();
            self.applyTheme(settings);
            self.saveToLocal(settings);
        });

        $('#theme_font_family').off('change').on('change', function() {
            var val = $(this).val();
            var settings = self.getFormSettings();
            self.applyTheme(settings);
            self.saveToLocal(settings);
        });

        $('#theme_font_weight').off('change').on('change', function() {
            var val = $(this).val();
            var settings = self.getFormSettings();
            self.applyTheme(settings);
            self.saveToLocal(settings);
        });

        $('.theme-preset-card').off('click').on('click', function() {
            var preset = $(this).data('preset');
            self.applyPreset(preset);
        });
    }
};

$(document).ready(function() {
    PosnicPro.themeManager.init();
});

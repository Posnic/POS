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
        preset: 'github',
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
        // Eye Comfort - built with real care for people at this screen 8+ hours a
        // day. The two biggest drivers of screen eye-strain are glare (pure-white
        // backgrounds) and blue light, so the background is a warm, low-blue
        // "paper" tone, not white. Text is a warm charcoal rather than pure black,
        // keeping contrast strong (~9:1, above WCAG AAA) without the harsh 21:1 of
        // black-on-white that tires the eye. The accent is a muted sage-teal:
        // green sits at the eye's peak sensitivity (~555nm) and is the most restful
        // hue to look at all day. Same evidence base as e-reader sepia and the
        // Solarized palette, tuned for a POS that is open from morning to night.
        comfort: {
            name: 'Eye Comfort',
            type: 'light',
            primaryColor: '#4F7A69',
            bodyBg: '#F3ECDB',
            cardBg: '#FBF6EA',
            sidebarBg: '#EAE1CE',
            topbarBg: '#FBF6EA',
            textPrimary: '#3A352B',
            textSecondary: '#5B5545',
            borderColor: '#E2D7BF',
            menuBg: '#EAE1CE',
            menuText: '#4A4433',
            menuActiveBg: '#4F7A69',
            menuActiveText: '#FFFFFF'
        },
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
        terminal: {
            name: 'Terminal (B&W)',
            type: 'dark',
            primaryColor: '#e8e8e8',
            bodyBg: '#0c0c0c',
            cardBg: '#161616',
            sidebarBg: '#0c0c0c',
            topbarBg: '#161616',
            textPrimary: '#e8e8e8',
            textSecondary: '#b0b0b0',
            menuBg: '#0c0c0c',
            menuText: '#cccccc',
            menuActiveBg: '#2a2a2a',
            menuActiveText: '#ffffff'
        },
        dosblue: {
            name: 'Turbo C (DOS)',
            type: 'dark',
            primaryColor: '#ffff55',
            bodyBg: '#0000aa',
            cardBg: '#0000aa',
            sidebarBg: '#0000aa',
            topbarBg: '#000080',
            textPrimary: '#eaeaea',
            textSecondary: '#b8b8e0',
            menuBg: '#0000aa',
            menuText: '#d8d8d8',
            menuActiveBg: '#00aaaa',
            menuActiveText: '#000000'
        },
        macos: {
            name: 'macOS',
            type: 'light',
            primaryColor: '#007aff',
            bodyBg: '#ececec',
            cardBg: '#ffffff',
            sidebarBg: '#f5f5f7',
            topbarBg: '#f5f5f7',
            textPrimary: '#1d1d1f',
            textSecondary: '#3a3a3c',
            menuBg: '#f5f5f7',
            menuText: '#1d1d1f',
            menuActiveBg: '#007aff',
            menuActiveText: '#ffffff'
        },
        github: {
            name: 'GitHub',
            type: 'light',
            primaryColor: '#0969da',
            bodyBg: '#f6f8fa',
            cardBg: '#ffffff',
            sidebarBg: '#ffffff',
            topbarBg: '#ffffff',
            textPrimary: '#1f2328',
            textSecondary: '#424a53',
            menuBg: '#ffffff',
            menuText: '#1f2328',
            menuActiveBg: '#0969da',
            menuActiveText: '#ffffff'
        },
        cleanlight: {
            name: 'Clean Light',
            type: 'light',
            primaryColor: '#5b5bd6',
            bodyBg: '#fbfbfb',
            cardBg: '#ffffff',
            sidebarBg: '#fbfbfb',
            topbarBg: '#ffffff',
            textPrimary: '#18181b',
            textSecondary: '#52525b',
            menuBg: '#fbfbfb',
            menuText: '#3f3f46',
            menuActiveBg: '#eef0f4',
            menuActiveText: '#18181b'
        },
        softdark: {
            name: 'Soft Dark',
            type: 'dark',
            primaryColor: '#4aa3ff',
            bodyBg: '#16181d',
            cardBg: '#1d2026',
            sidebarBg: '#1a1d23',
            topbarBg: '#1d2026',
            textPrimary: '#e6e6e6',
            textSecondary: '#a7adba',
            menuBg: '#1a1d23',
            menuText: '#c3c8d2',
            menuActiveBg: '#252932',
            menuActiveText: '#ffffff'
        },
        warmnight: {
            name: 'Warm Night',
            type: 'dark',
            primaryColor: '#e0a458',
            bodyBg: '#1c1a17',
            cardBg: '#252119',
            sidebarBg: '#211d16',
            topbarBg: '#252119',
            textPrimary: '#ede4d3',
            textSecondary: '#b8ab97',
            menuBg: '#211d16',
            menuText: '#cabfa9',
            menuActiveBg: '#3a3226',
            menuActiveText: '#f4ecdc'
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
        // Highlight the currently-applied theme whenever the picker opens.
        if (window.jQuery) {
            window.jQuery(document).on('shown.bs.dropdown', '#dropdown-theme', function () { self.markActiveThemeItem(); });
        }
    },

    markActiveThemeItem: function() {
        try {
            var active = document.documentElement.getAttribute('data-theme') || 'github';
            var items = document.querySelectorAll('#dropdown-theme .theme-item');
            for (var i = 0; i < items.length; i++) {
                if (items[i].getAttribute('data-preset') === active) items[i].classList.add('theme-active');
                else items[i].classList.remove('theme-active');
            }
        } catch (e) {}
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
            // "Default" is now the GitHub theme (old blue rail).
            var applied = (state.preset === 'default') ? 'github' : state.preset;
            root.setAttribute('data-theme', applied);
            document.body.setAttribute('data-theme', applied);
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

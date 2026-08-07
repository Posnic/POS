# Posnic Theme System Documentation

## Overview
The Posnic POS application supports multiple light and dark themes with full customization. Themes are applied via CSS variables and `data-theme` attributes on the `<body>` element.

---

## Architecture

### Files Involved

| File | Purpose |
|------|---------|
| `static/style/css/theme-variables.css` | CSS variables and theme-specific overrides |
| `static/script/js/core/themeManager.js` | JavaScript theme management (apply, save, load) |
| `modules/settings_write.html` | Theme preset cards UI in settings |
| **Backend:** `src/controller/setting.php` | API endpoints for theme CRUD |
| **Backend:** `src/model/setting_model.php` | MongoDB operations for theme storage |

---

## CSS Theme System

### How It Works
1. Theme presets use `[data-theme="themeName"]` CSS selectors
2. CSS variables are defined in `:root` and overridden per theme
3. `!important` is used to override inline styles and Bootstrap defaults

### Core CSS Variables
```css
:root {
    --theme-primary-color: #506fe4;
    --theme-primary-hover: #3a5bc7;
    --theme-body-bg: #f2f3f7;
    --theme-card-bg: #ffffff;
    --theme-sidebar-bg: #ffffff;
    --theme-topbar-bg: #ffffff;
    --theme-text-primary: #141d46;
    --theme-text-secondary: #8A98AC;
    --theme-border-color: #e6e6e6;
    --theme-menu-bg: #ffffff;
    --theme-menu-text: #8A98AC;
    --theme-menu-active-bg: #506fe4;
    --theme-menu-active-text: #ffffff;
    --theme-font-family: 'Mukta Vaani', sans-serif;
    --theme-font-size-base: 16px;
    --theme-font-weight: 300;
    --theme-btn-primary-bg: #506fe4;
}
```

### Adding a New Theme (CSS)

1. Add CSS variables block:
```css
[data-theme="mytheme"] {
    --theme-primary-color: #FF5722;
    --theme-primary-hover: #E64A19;
    --theme-body-bg: #FBE9E7;
    --theme-card-bg: #ffffff;
    --theme-sidebar-bg: #BF360C;
    --theme-menu-bg: #BF360C;
    --theme-menu-text: #ffffff;
    --theme-menu-active-bg: #D84315;
    --theme-menu-active-text: #ffffff;
    --theme-text-primary: #3E2723;
    --theme-text-secondary: #5D4037;
}
```

2. Add UI element overrides (required for visibility):
```css
[data-theme="mytheme"] .card { background-color: #ffffff !important; }
[data-theme="mytheme"] .vertical-menu { background-color: #FFCCBC !important; }
[data-theme="mytheme"] .vertical-menu li a { color: #BF360C !important; }
[data-theme="mytheme"] .leftbar { background-color: #FFCCBC !important; }
[data-theme="mytheme"] a { color: #BF360C; }
[data-theme="mytheme"] .btn-primary { background-color: #FF5722 !important; border-color: #FF5722 !important; }
[data-theme="mytheme"] thead.btn-primary { background-color: #FF5722 !important; }
[data-theme="mytheme"] .nav-pills .nav-link { color: #BF360C !important; }
[data-theme="mytheme"] .btn-outline-primary { color: #FF5722 !important; border-color: #FF5722 !important; }
[data-theme="mytheme"] .btn-primary-rgba { background-color: rgba(255, 87, 34, 0.1) !important; color: #BF360C !important; }
[data-theme="mytheme"] .table_model_item { color: #BF360C !important; }
```

3. For **dark themes**, add these additional overrides:
```css
[data-theme="mydarktheme"] .table { color: #e4e4e7 !important; }
[data-theme="mydarktheme"] .table thead th { background-color: #2d2d30 !important; color: #e4e4e7 !important; }
[data-theme="mydarktheme"] .table tbody tr { background-color: #252526 !important; color: #cccccc !important; }
[data-theme="mydarktheme"] .table-striped tbody tr:nth-of-type(odd) { background-color: #2d2d30 !important; }
[data-theme="mydarktheme"] .modal-content { background-color: #252526 !important; color: #e4e4e7 !important; }
[data-theme="mydarktheme"] .dropdown-menu { background-color: #252526 !important; }
[data-theme="mydarktheme"] .dropdown-item { color: #cccccc !important; }
[data-theme="mydarktheme"] input, [data-theme="mydarktheme"] select, [data-theme="mydarktheme"] textarea {
    background-color: #3c3c3c !important;
    color: #e4e4e7 !important;
    border-color: #3c3c3c !important;
}
[data-theme="mydarktheme"] h1, [data-theme="mydarktheme"] h2, [data-theme="mydarktheme"] h3,
[data-theme="mydarktheme"] h4, [data-theme="mydarktheme"] h5, [data-theme="mydarktheme"] h6 {
    color: #e4e4e7 !important;
}
[data-theme="mydarktheme"] #chartdiv, [data-theme="mydarktheme"] .chartdiv {
    background-color: #ffffff !important;
    border-radius: 5px;
}
```

---

## JavaScript Theme Manager

### Location
`static/script/js/core/themeManager.js`

### Key Methods

| Method | Purpose |
|--------|---------|
| `init()` | Loads theme from localStorage or server on page load |
| `loadFromServer()` | Fetches theme from backend API if no localStorage |
| `applyTheme(settings)` | Applies CSS variables and `data-theme` attribute |
| `applyPreset(presetName)` | Applies a preset theme by name |
| `saveSettings(callback)` | Saves theme to localStorage and backend |
| `saveToLocal(settings)` | Saves to localStorage |
| `getFromLocal()` | Retrieves from localStorage |
| `updateFormFieldsSilent(settings)` | Updates settings UI inputs without triggering events |
| `loadThemeSettingsUI()` | Initializes the settings page UI |

### Adding a New Preset (JavaScript)

Add to `themeManager.presets` object:
```javascript
mytheme: {
    name: 'My Theme',
    type: 'light', // or 'dark'
    primaryColor: '#FF5722',
    bodyBg: '#FBE9E7',
    cardBg: '#ffffff',
    sidebarBg: '#BF360C',
    topbarBg: '#ffffff',
    textPrimary: '#3E2723',
    textSecondary: '#5D4037',
    menuBg: '#BF360C',
    menuText: '#ffffff',
    menuActiveBg: '#D84315',
    menuActiveText: '#ffffff'
},
```

---

## Settings UI (Theme Cards)

### Location
`modules/settings_write.html`

### Adding a Theme Card

Add inside the appropriate section (Light or Dark themes):
```html
<div class="col-md-2 col-sm-4 col-6 mb-3">
    <div class="theme-preset-card" data-preset="mytheme">
        <div class="theme-preview">
            <div class="preview-sidebar" style="background-color: #BF360C;"></div>
            <div class="preview-content">
                <div class="preview-topbar" style="background-color: #ffffff;"></div>
                <div class="preview-body" style="background-color: #FBE9E7;">
                    <div class="preview-card" style="background-color: #ffffff;"></div>
                </div>
            </div>
        </div>
        <div class="theme-name">My Theme</div>
        <div class="theme-colors">
            <span class="color-swatch" style="background-color: #FF5722;"></span>
            <span class="color-swatch" style="background-color: #BF360C;"></span>
            <span class="color-swatch" style="background-color: #FBE9E7;"></span>
        </div>
    </div>
</div>
```

---

## Backend API

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `setting/getThemeSettings` | Retrieve saved theme |
| PUT | `setting/updateThemeSettings` | Save theme settings |

### Data Structure (MongoDB)
```json
{
    "theme_settings": {
        "preset": "dark",
        "primaryColor": "#569cd6",
        "bodyBg": "#1e1e1e",
        "cardBg": "#252526",
        "sidebarBg": "#252526",
        "topbarBg": "#323233",
        "textPrimary": "#e4e4e7",
        "textSecondary": "#cccccc",
        "fontFamily": "'Mukta Vaani', sans-serif",
        "fontSize": "16",
        "fontWeight": "300",
        "borderColor": "#3c3c3c",
        "menuBg": "#252526",
        "menuText": "#cccccc",
        "menuActiveBg": "#37373d",
        "menuActiveText": "#ffffff"
    }
}
```

---

## Available Themes

### Light Themes
| Preset Name | Display Name | Primary Color |
|-------------|--------------|---------------|
| `default` | Default | #506fe4 |
| `blue` | Blue | #2196F3 |
| `green` | Green | #4CAF50 |
| `purple` | Purple | #9C27B0 |
| `orange` | Orange | #FF9800 |
| `teal` | Teal | #009688 |
| `pink` | Pink | #E91E63 |
| `amber` | Amber | #FFC107 |
| `indigo` | Indigo | #3F51B5 |
| `lime` | Lime | #CDDC39 |
| `cyan` | Cyan | #00BCD4 |
| `brown` | Coffee | #795548 |

### Dark Themes
| Preset Name | Display Name | Primary Color |
|-------------|--------------|---------------|
| `dark` | Dark (VS Code) | #569cd6 |
| `midnight` | Midnight Blue | #6C63FF |
| `dracula` | Dracula | #bd93f9 |
| `solarized` | Solarized | #268bd2 |
| `gruvbox` | Gruvbox | #fe8019 |
| `onedark` | One Dark | #61afef |
| `material` | Material | #03dac6 |
| `forest` | Forest | #4caf50 |

---

## Common Issues & Fixes

### Issue: Theme not applying on first click
**Cause:** CSS specificity or missing `data-theme` attribute
**Fix:** Ensure `document.body.setAttribute('data-theme', presetName)` is called and CSS has `[data-theme="..."]` selectors

### Issue: Elements have white background in dark theme
**Cause:** Inline styles or Bootstrap defaults override theme
**Fix:** Add specific overrides with `!important`:
```css
[data-theme="dark"] .element-class { background-color: #252526 !important; }
```

### Issue: Font size change resets theme colors
**Cause:** `getFormSettings()` was returning `preset: 'custom'`
**Fix:** Preserve current preset in `getFormSettings()` and only update specific CSS property

### Issue: Theme not loading on fresh login
**Cause:** No localStorage data, server fetch not implemented
**Fix:** `init()` calls `loadFromServer()` if no localStorage data exists

---

## Build Process

After making theme changes:
```bash
cd /path/to/FE
npm run build
```

This compiles CSS/JS and generates `public/` output files.

---

## Checklist for Adding New Theme

- [ ] Add CSS variables block in `theme-variables.css`
- [ ] Add UI element overrides (card, menu, buttons, etc.)
- [ ] Add preset object in `themeManager.js`
- [ ] Add theme card HTML in `settings_write.html`
- [ ] Run `npm run build`
- [ ] Test theme application and persistence

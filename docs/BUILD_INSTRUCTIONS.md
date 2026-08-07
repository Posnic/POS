# Posnic Build Instructions

## Prerequisites

Before building, ensure you have:

1. **Node.js and npm installed** (for development)
2. **Bundled MongoDB downloaded**
   ```bash
   cd path\to\POS
   download-mongodb.bat
   ```
3. **api dependencies installed**
   ```bash
   cd api
   npm install
   ```

## Quick start

```bash
npm install
npm --prefix api install
npm run build          # Windows installer into dist/
```

No token is needed. Releases are public, so the updater reads them without
credentials of any kind.

## Build Process

### Step 1: Clean Previous Builds
```bash
# Remove old build artifacts
Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
```

### Step 2: Verify Structure
Ensure these folders exist:
```
POS\
├── api\
│   ├── node_modules\     ✅ Must exist
│   ├── src\
│   ├── app.js
│   └── server.js
├── web\
│   └── public\
├── mongodb\
│   ├── bin\
│   │   └── mongod.exe    ✅ Must exist
│   ├── data\
│   └── log\
└── nodejs\               (optional)
    └── node.exe
```

### Step 3: Build
```bash
npm run build
```

This will create:
```
dist\
└── Posnic Setup 1.0.0.exe
```

## Build Configuration

### What Gets Included

**Main App Files:**
- main.js, server.js, preload.js
- HTML files (loading, install-wizard, hardware-manager)
- Manager scripts (mongodb-manager, hardware-manager, etc.)
- Setup scripts (.bat files)

**Extra Resources:**
- `api/` - the API server and its node_modules, minus tests and dev scripts
- `frontend/` - the built web assets (this was `web/` in an older layout)
- `mongodb/` - the MongoDB server, fetched by `download-mongodb.bat` rather than
  kept in git; `npm run check:mongodb` refuses to build without it
- `brand-seed/` - empty in a stock build; white-label installers are produced
  from a separate private repository

Node is **not** bundled: the API runs in-process on the Node inside Electron.

### Build Settings

```json
{
  "asar": false,              // No ASAR packaging (easier debugging)
  "compression": "store",     // No compression (faster)
  "extraResources": [
    "api with node_modules",
    "web",
    "mongodb",
    "nodejs"
  ]
}
```

## Testing Built App

### Step 1: Install
Run the generated installer:
```
dist\Posnic Setup 1.0.0.exe
```

### Step 2: Verify Installation
Check installed location (usually):
```
C:\Users\[Username]\AppData\Local\Programs\Posnic\
```

### Step 3: Check Resources
Verify resources folder:
```
C:\Users\[Username]\AppData\Local\Programs\Posnic\resources\
├── api\
├── web\
├── mongodb\
└── nodejs\
```

### Step 4: Run
Launch from Start Menu or Desktop shortcut.

### Step 5: Check Logs
If issues occur, check:
```
C:\Users\[Username]\AppData\Roaming\Posnic\logs\
```

## Troubleshooting

### Build Fails

**Error: Cannot find module**
```bash
# Install api dependencies
cd api
npm install
```

**Error: MongoDB not found**
```bash
# Download MongoDB
download-mongodb.bat
```

### Built App Won't Start

**Check paths in logs:**
- Look for "isPackaged: true"
- Verify "process.resourcesPath" points to correct location
- Check if api, mongodb folders exist in resources

**MongoDB won't start:**
- Check `resources\mongodb\bin\mongod.exe` exists
- Check `resources\mongodb\data` folder exists
- Check Windows Defender isn't blocking

**API Server won't start:**
- Check `resources\api\node_modules` exists
- Check `resources\api\server.js` exists
- Verify MongoDB is running first

### White Screen

**Causes:**
1. API server failed to start
2. MongoDB not running
3. web files missing

**Debug:**
1. Open DevTools (Ctrl+Shift+I)
2. Check Console for errors
3. Check Network tab for failed requests

## Size Information

### Installer Size
- Base Electron: ~150MB
- api + node_modules: ~100MB
- web: ~50MB
- MongoDB: ~300MB
- Node.js: ~70MB (if included)
- **Total: ~620-670MB**

### Installed Size
- Slightly larger due to extracted files
- **Total: ~700-750MB**

## Distribution

### Single Installer
The built installer is completely self-contained:
- ✅ No MongoDB installation needed
- ✅ No Node.js installation needed
- ✅ No external dependencies
- ✅ Works on any Windows 10/11 PC

### System Requirements
- **OS:** Windows 10/11 (64-bit)
- **RAM:** 4GB minimum, 8GB recommended
- **Disk:** 1GB free space
- **Network:** Not required (works offline)

## Build Variants

### Development Build (Faster)
```bash
npm run build
```
- No code signing
- No compression
- Faster build time

### Production Build (Smaller)
```json
{
  "compression": "maximum",
  "asar": true
}
```
- Smaller size
- Slower build time
- Harder to debug

## Updating

### To Update the App

1. **Update version in package.json:**
   ```json
   {
     "version": "1.1.0"
   }
   ```

2. **Rebuild:**
   ```bash
   npm run build
   ```

3. **New installer created:**
   ```
   dist\Posnic Setup 1.1.0.exe
   ```

## Notes

- Build time: 5-10 minutes (depending on PC)
- First build is slower (downloads Electron)
- Subsequent builds are faster
- Build output is in `dist/` folder
- Old builds are automatically cleaned

## Success Checklist

Before distributing, verify:
- ✅ Installer runs without errors
- ✅ App starts and shows installation wizard
- ✅ MongoDB starts automatically
- ✅ API server starts on port 5000
- ✅ Can create first user
- ✅ Can login after setup
- ✅ Hardware manager works
- ✅ App closes cleanly

**Build process 100% working! Self-contained installer ready for distribution! 🎉**

# Build Commands

## Production Build (with minification)
```bash
npm run build
```
This command will:
- Install dependencies
- Build CSS, JS, and HTML with minification
- Create a zip file of the build

## Development Build (without minification)
```bash
npm run build:dev
```
This command will:
- Install dependencies
- Build CSS, JS, and HTML **without minification** (human-readable output)
- Create a zip file of the build

**Use this for debugging or when you need to inspect the generated code.**

## How it works

The build system uses the `NODE_ENV` environment variable to determine whether to minify:
- `NODE_ENV=prod` (default) - Minified output
- `NODE_ENV=dev` - Non-minified, human-readable output

The `build:dev` command uses `cross-env` to set `NODE_ENV=dev` in a cross-platform way (works on Windows, Mac, and Linux).

## Files affected by minification

- **JavaScript**: All JS files in `static/script/js/modules/js/` are concatenated
  - Production: Minified into single files per page
  - Development: Concatenated with semicolons and newlines for readability
  
- **CSS**: All CSS/SCSS files are processed
  - Production: Minified
  - Development: Expanded with source maps

- **HTML**: All HTML files
  - Production: Minified
  - Development: Formatted with proper indentation

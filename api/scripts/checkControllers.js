const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "../src/routes");
const controllersDir = path.join(__dirname, "../src/controllers");

// Ensure directories exist
[routesDir, controllersDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
});

// Read all route files
const routeFiles = fs
  .readdirSync(routesDir)
  .filter(
    (file) =>
      file.endsWith(".js") && !["index.js", "authRoutes.js"].includes(file),
  );

console.log("Checking route controllers...");
let allGood = true;

routeFiles.forEach((routeFile) => {
  const routePath = path.join(routesDir, routeFile);
  const content = fs.readFileSync(routePath, "utf8");

  // Extract controller imports
  const controllerImports =
    content.match(/require\('..\/controllers\/([^']+)'\)/g) || [];

  if (controllerImports.length === 0) {
    console.log(`⚠️  No controller imports found in ${routeFile}`);
    allGood = false;
    return;
  }

  // Check each controller
  controllerImports.forEach((importStr) => {
    const controllerPath = importStr
      .match(/require\('..\/controllers\/([^']+)'\)/)[1]
      .replace(/'/g, "");

    const fullControllerPath = path.join(
      controllersDir,
      `${controllerPath}.js`,
    );

    if (!fs.existsSync(fullControllerPath)) {
      console.error(`❌ Missing controller: ${controllerPath}.js`);
      allGood = false;
    } else {
      console.log(`✓ Found controller: ${controllerPath}.js`);
    }
  });
});

if (allGood) {
  console.log("✅ All routes have corresponding controllers!");
} else {
  console.log(
    "\nSome controllers are missing. Please create the missing controller files.",
  );
  process.exit(1);
}

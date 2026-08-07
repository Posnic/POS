const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "../src/routes");

// Ensure routes directory exists
if (!fs.existsSync(routesDir)) {
  console.error("Routes directory not found");
  process.exit(1);
}

// Read all route files
fs.readdir(routesDir, (err, files) => {
  if (err) {
    console.error("Error reading routes directory:", err);
    return;
  }

  // Skip these files
  const skipFiles = ["index.js"];

  // Process each route file
  files.forEach((file) => {
    if (!file.endsWith(".js") || skipFiles.includes(file)) {
      return;
    }

    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, "utf8");

    // Check if the file already has JSDoc comments
    if (
      content.includes("@route") ||
      content.includes("@desc") ||
      content.includes("@access")
    ) {
      console.log(`✓ ${file} is already documented`);
      return;
    }

    // Add JSDoc comments to the route file
    const routeName = file.replace(".js", "").replace("Routes", "");
    const routePath = `/${routeName.toLowerCase()}s`;

    const jsDocTemplate = `/**
 * @route   GET ${routePath}
 * @desc    Get all ${routeName}s
 * @access  Private
 */

/**
 * @route   POST ${routePath}
 * @desc    Create a new ${routeName}
 * @access  Private
 */

/**
 * @route   GET ${routePath}/:id
 * @desc    Get a single ${routeName}
 * @access  Private
 */

/**
 * @route   PATCH ${routePath}/:id
 * @desc    Update a ${routeName}
 * @access  Private
 */

/**
 * @route   DELETE ${routePath}/:id
 * @desc    Delete a ${routeName}
 * @access  Private
 */

`;

    // Add JSDoc comments to the beginning of the file
    const updatedContent = jsDocTemplate + content;

    // Save the updated content
    fs.writeFileSync(filePath, updatedContent, "utf8");
    console.log(`✓ Added JSDoc comments to ${file}`);
  });

  console.log("Route documentation update complete!");
});

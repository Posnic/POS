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
  const skipFiles = ["authRoutes.js", "index.js"];

  // Process each route file
  files.forEach((file) => {
    if (!file.endsWith(".js") || skipFiles.includes(file)) {
      return;
    }

    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, "utf8");

    // Check if the route is already protected
    if (
      content.includes("protect,") ||
      content.includes("protect ,") ||
      content.includes("protect, ") ||
      content.includes("protect , ")
    ) {
      console.log(`✓ ${file} is already protected`);
      return;
    }

    // Add protect middleware to the route file
    const updatedContent = content.replace(
      /(const express = require\('express'\);\s+const router = express\.Router\(\);)(\s+const \{ [^}]+ \} = require\('..\/controllers\/[^']+'\);)(\s*)/,
      (match, p1, p2, p3) => {
        // Extract the controller import to get the controller name
        const controllerMatch = p2.match(
          /const \{ ([^}]+) \} = require\('..\/controllers\/([^']+)'\)/,
        );
        if (!controllerMatch) return match;

        const controllerName = controllerMatch[2].split("/").pop();
        const controllerVar = controllerMatch[1];

        return `const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const ${controllerVar} = require('../controllers/${controllerName}');

// Protect all routes after this middleware
router.use(protect);
`;
      },
    );

    // Save the updated content
    fs.writeFileSync(filePath, updatedContent, "utf8");
    console.log(`✓ Updated ${file} with protect middleware`);
  });

  console.log("Route protection update complete!");
});

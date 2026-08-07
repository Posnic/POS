const fs = require("fs");
const path = require("path");

const modelsDir = path.join(__dirname, "../src/models");

// Ensure models directory exists
if (!fs.existsSync(modelsDir)) {
  console.error("Models directory not found");
  process.exit(1);
}

// Read all model files
fs.readdir(modelsDir, (err, files) => {
  if (err) {
    console.error("Error reading models directory:", err);
    return;
  }

  // Process each file
  files.forEach((file) => {
    // Skip non-JavaScript files and base model
    if (
      !file.endsWith(".js") ||
      file === "base_model.js" ||
      file === "plugins.js"
    ) {
      return;
    }

    const oldPath = path.join(modelsDir, file);
    let newName;

    // Handle _model.js files
    if (file.endsWith("_model.js")) {
      newName =
        file
          .replace("_model.js", "")
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join("") + ".js";
    }
    // Handle other model files
    else if (file !== "BaseModel.js") {
      newName =
        file
          .replace(".js", "")
          .split("_")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join("") + ".js";
    } else {
      return; // Skip if already in correct format
    }

    const newPath = path.join(modelsDir, newName);

    // Rename the file
    fs.rename(oldPath, newPath, (err) => {
      if (err) {
        console.error(`Error renaming ${file}:`, err);
      } else {
        console.log(`Renamed ${file} to ${newName}`);

        // Update the file content to reflect the new model name
        if (fs.existsSync(newPath)) {
          let content = fs.readFileSync(newPath, "utf8");

          // Update model name in the file
          const modelName = newName.replace(".js", "");
          content = content.replace(
            /model\('([^']+)',/g,
            `model('${modelName}',`,
          );

          // Update export if needed
          content = content.replace(
            /module\.exports\s*=\s*[\w.]+;?/,
            `module.exports = ${modelName};`,
          );

          fs.writeFileSync(newPath, content, "utf8");
        }
      }
    });
  });

  console.log("Model standardization complete!");
});

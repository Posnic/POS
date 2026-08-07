const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("../src/utils/logger");

// Create necessary directories
const directories = [
  "logs",
  "public/uploads",
  "src/controllers",
  "src/middleware",
  "src/models",
  "src/routes",
  "src/utils",
  "src/validations",
  "tests/unit",
  "tests/integration",
];

// Create directories if they don't exist
directories.forEach((dir) => {
  const dirPath = path.join(__dirname, "..", dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Created directory: ${dirPath}`);
  }
});

// Set up .gitignore if it doesn't exist
const gitignorePath = path.join(__dirname, "../.gitignore");
if (!fs.existsSync(gitignorePath)) {
  const gitignoreContent = `# Dependencies
node_modules/

# Environment variables
.env

# Logs
logs
*.log
npm-debug.log*

# Coverage directory
coverage/

# IDE specific files
.vscode/
.idea/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes

# Build output
dist/
build/

# Misc
.DS_Store
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
`;

  fs.writeFileSync(gitignorePath, gitignoreContent);
  logger.info("Created .gitignore file");
}

// Install required dependencies
logger.info("Installing required dependencies...");
try {
  const dependencies = [
    "express",
    "mongoose",
    "dotenv",
    "joi",
    "winston",
    "winston-daily-rotate-file",
    "helmet",
    "cors",
    "compression",
    "http-status",
    "bcryptjs",
    "jsonwebtoken",
    "multer",
    "aws-sdk",
    "razorpay",
    "sib-api-v3-sdk",
    "express-rate-limit",
    "express-mongo-sanitize",
    "xss-clean",
    "hpp",
  ];

  const devDependencies = [
    "nodemon",
    "eslint",
    "prettier",
    "jest",
    "supertest",
    "eslint-config-prettier",
    "eslint-plugin-prettier",
    "eslint-config-airbnb-base",
    "eslint-plugin-import",
    "eslint-plugin-jest",
  ];

  logger.info("Installing production dependencies...");
  execSync(`npm install --save ${dependencies.join(" ")}`, {
    stdio: "inherit",
  });

  logger.info("Installing development dependencies...");
  execSync(`npm install --save-dev ${devDependencies.join(" ")}`, {
    stdio: "inherit",
  });

  logger.info("Dependencies installed successfully!");
} catch (error) {
  logger.error("Error installing dependencies:", error);
  process.exit(1);
}

// Generate .env.example file
logger.info("Generating .env.example file...");
const generateEnv = require("./generate-env");

logger.info("\n✅  Project initialization complete!");
logger.info("\nNext steps:");
logger.info("1. Copy .env.example to .env");
logger.info("2. Update the values in .env with your configuration");
logger.info("3. Run `npm run dev` to start the development server");

// Run configuration validation
const { validateConfig } = require("./validate-config");
validateConfig();

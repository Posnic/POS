const { config } = require("../src/config");
const logger = require("../src/utils/logger");

/**
 * Validates the application configuration
 * @returns {boolean} True if configuration is valid
 */
function validateConfig() {
  const requiredConfig = [
    "NODE_ENV",
    "MONGODB_URI",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_USERNAME",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
    "SESSION_SECRET",
    "POSNIC_KEY",
    "POSNIC_SECRET",
  ];

  let isValid = true;
  const missingVars = [];

  requiredConfig.forEach((key) => {
    if (!process.env[key]) {
      missingVars.push(key);
      isValid = false;
    }
  });

  if (!isValid) {
    logger.error("Missing required environment variables:");
    missingVars.forEach((v) => logger.error(`- ${v}`));
    logger.info(
      "\nPlease check your .env file and ensure all required variables are set.",
    );
    process.exit(1);
  }

  // Validate email configuration if email is enabled
  if (process.env.EMAIL_ENABLED === "true") {
    const emailConfig = [
      "EMAIL_HOST",
      "EMAIL_PORT",
      "EMAIL_USERNAME",
      "EMAIL_PASSWORD",
      "EMAIL_FROM",
    ];

    emailConfig.forEach((key) => {
      if (!process.env[key]) {
        logger.warn(
          `Email is enabled but ${key} is not set. Email functionality may not work correctly.`,
        );
      }
    });
  }

  // Validate AWS configuration if file upload is enabled
  if (process.env.FILE_UPLOAD_ENABLED === "true") {
    const awsConfig = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
      "AWS_BUCKET_NAME",
    ];

    awsConfig.forEach((key) => {
      if (!process.env[key]) {
        logger.warn(
          `File upload is enabled but ${key} is not set. File uploads may not work correctly.`,
        );
      }
    });
  }

  logger.info("Configuration validation successful");
  return true;
}

// Run validation if this file is executed directly
if (require.main === module) {
  validateConfig();
}

module.exports = { validateConfig };

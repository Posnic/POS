const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const controllersDir = path.join(__dirname, "../src/controllers");
const modelNames = [
  "User",
  "Branch",
  "Category",
  "Supplier",
  "Customer",
  "Dashboard",
  "Expense",
  "Install",
  "Inventory",
  "Item",
  "Receiving",
  "Register",
  "Sale",
  "Setting",
  "StockLog",
];

// Ensure controllers directory exists
if (!fs.existsSync(controllersDir)) {
  await mkdir(controllersDir, { recursive: true });
}

// Generate controller for a model
async function generateController(modelName) {
  const controllerPath = path.join(
    controllersDir,
    `${modelName.toLowerCase()}Controller.js`,
  );

  // Skip if controller already exists
  if (fs.existsSync(controllerPath)) {
    console.log(`✓ Controller already exists: ${modelName}Controller.js`);
    return;
  }

  const controllerTemplate = `// ${modelName} Controller
const ${modelName} = require('../models/${modelName}');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// @desc    Get all ${modelName.toLowerCase()}s
// @route   GET /api/v1/${modelName.toLowerCase()}s
// @access  Private
const getAll${modelName}s = catchAsync(async (req, res, next) => {
  const ${modelName.toLowerCase()}s = await ${modelName}.find();
  
  res.status(200).json({
    status: 'success',
    results: ${modelName.toLowerCase()}s.length,
    data: {
      ${modelName.toLowerCase()}s
    }
  });
});

// @desc    Get single ${modelName.toLowerCase()}
// @route   GET /api/v1/${modelName.toLowerCase()}s/:id
// @access  Private
const get${modelName} = catchAsync(async (req, res, next) => {
  const ${modelName.toLowerCase()} = await ${modelName}.findById(req.params.id);
  
  if (!${modelName.toLowerCase()}) {
    return next(new AppError('No ${modelName} found with that ID', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      ${modelName.toLowerCase()}
    }
  });
});

// @desc    Create new ${modelName.toLowerCase()}
// @route   POST /api/v1/${modelName.toLowerCase()}s
// @access  Private
const create${modelName} = catchAsync(async (req, res, next) => {
  const new${modelName} = await ${modelName}.create(req.body);
  
  res.status(201).json({
    status: 'success',
    data: {
      ${modelName.toLowerCase()}: new${modelName}
    }
  });
});

// @desc    Update ${modelName.toLowerCase()}
// @route   PATCH /api/v1/${modelName.toLowerCase()}s/:id
// @access  Private
const update${modelName} = catchAsync(async (req, res, next) => {
  const ${modelName.toLowerCase()} = await ${modelName}.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true
    }
  );
  
  if (!${modelName.toLowerCase()}) {
    return next(new AppError('No ${modelName} found with that ID', 404));
  }
  
  res.status(200).json({
    status: 'success',
    data: {
      ${modelName.toLowerCase()}
    }
  });
});

// @desc    Delete ${modelName.toLowerCase()}
// @route   DELETE /api/v1/${modelName.toLowerCase()}s/:id
// @access  Private
const delete${modelName} = catchAsync(async (req, res, next) => {
  const ${modelName.toLowerCase()} = await ${modelName}.findByIdAndDelete(req.params.id);
  
  if (!${modelName.toLowerCase()}) {
    return next(new AppError('No ${modelName} found with that ID', 404));
  }
  
  res.status(204).json({
    status: 'success',
    data: null
  });
});

module.exports = {
  getAll${modelName}s,
  get${modelName},
  create${modelName},
  update${modelName},
  delete${modelName}
};
`;

  try {
    await writeFile(controllerPath, controllerTemplate);
    console.log(`✓ Created controller: ${modelName}Controller.js`);
  } catch (err) {
    console.error(`Error creating ${modelName}Controller.js:`, err);
  }
}

// Generate controllers for all models
async function generateAllControllers() {
  for (const modelName of modelNames) {
    await generateController(modelName);
  }
  console.log("✅ Controller generation complete!");
}

// Run the generator
generateAllControllers().catch(console.error);

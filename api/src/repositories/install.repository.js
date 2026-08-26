// src/repositories/install.repository.js
const BaseModel = require('../models/base.model');
require('mongodb');
const { CLEANUP_COLLECTIONS } = require('../constants/install.constants');

/**
 * Install Repository
 * Handles all database operations for installation
 * Separates data access logic from business logic
 */
class InstallRepository extends BaseModel {
  constructor() {
    super('branches');
  }

  /**
   * Check if user already exists by username, email, or license
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.email
   * @param {ObjectId} params.licenseId
   * @returns {Promise<Object|null>}
   */
  async findExistingUser({ username, email, licenseId }) {
    const userCollection = await this.getCollection('users');
    return await userCollection.findOne({
      $or: [{ username: username }, { email: email }, { license: licenseId }],
    });
  }

  /**
   * Insert a new user
   * @param {Object} userData - User data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertUser(userData) {
    const userCollection = await this.getCollection('users');
    const result = await userCollection.insertOne(userData);
    return result.insertedId;
  }

  /**
   * Update user with branch access and printing design
   * @param {ObjectId} userId
   * @param {ObjectId} licenseId
   * @param {Object} updateData
   */
  async updateUserBranchAccess(userId, licenseId, updateData) {
    const userCollection = await this.getCollection('users');
    await userCollection.updateOne({ _id: userId, license: licenseId }, { $set: updateData });
  }

  /**
   * Insert a new branch
   * @param {Object} branchData - Branch data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertBranch(branchData) {
    const branchCollection = await this.getCollection('branches');
    const result = await branchCollection.insertOne(branchData);
    return result.insertedId;
  }

  /**
   * Update branch with default values
   * @param {ObjectId} branchId
   * @param {ObjectId} licenseId
   * @param {Object} updateData
   */
  async updateBranch(branchId, licenseId, updateData) {
    const branchCollection = await this.getCollection('branches');
    await branchCollection.updateOne({ _id: branchId, license: licenseId }, { $set: updateData });
  }

  /**
   * Add email fields to branch
   * @param {ObjectId} branchId
   * @param {ObjectId} licenseId
   * @param {Object} emailData
   */
  async addBranchEmailFields(branchId, licenseId, emailData) {
    const branchCollection = await this.getCollection('branches');
    await branchCollection.updateOne(
      { _id: branchId, license: licenseId },
      { $push: { email_fields: emailData } }
    );
  }

  /**
   * The units a branch already has, so the demo seed joins the shop's own
   * master instead of duplicating it.
   * @param {ObjectId} branchId
   * @param {ObjectId} licenseId
   * @returns {Promise<Array>}
   */
  async findUnitsByBranch(branchId, licenseId) {
    const unitCollection = await this.getCollection('unit');
    return unitCollection
      .find({ branch_id: branchId, license: licenseId }, { projection: { _id: 1, value: 1 } })
      .toArray();
  }

  /**
   * Insert a tax record
   * @param {Object} taxData - Tax data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertTax(taxData) {
    const taxCollection = await this.getCollection('grouptax');
    const result = await taxCollection.insertOne(taxData);
    return result.insertedId;
  }

  /**
   * Insert a customer
   * @param {Object} customerData - Customer data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertCustomer(customerData) {
    const customerCollection = await this.getCollection('customers');
    const result = await customerCollection.insertOne(customerData);
    return result.insertedId;
  }

  /**
   * Insert a supplier
   * @param {Object} supplierData - Supplier data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertSupplier(supplierData) {
    const supplierCollection = await this.getCollection('suppliers');
    const result = await supplierCollection.insertOne(supplierData);
    return result.insertedId;
  }

  /**
   * Insert a unit
   * @param {Object} unitData - Unit data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertUnit(unitData) {
    const unitCollection = await this.getCollection('unit');
    const result = await unitCollection.insertOne(unitData);
    return result.insertedId;
  }

  /**
   * Insert multiple categories
   * @param {Array} categoriesData - Array of category objects
   * @returns {Promise<Array<ObjectId>>}
   */
  async insertCategories(categoriesData) {
    const categoryCollection = await this.getCollection('categories');
    console.log(`🗄️ Repository: Inserting ${categoriesData.length} categories into DB...`);
    /*
     * Upsert, never blind-insert. Categories carry a unique
     * (name, branch_id) index, and a RESEED meets survivors: the purge
     * keeps sold items and their categories, so the next pack's
     * "Paper & Office" collides with the old pack's, insertMany threw
     * E11000, and the whole demo install died half-done - the owner saw
     * "restored 30 products" and a list of 11. An existing category is
     * simply reused; only genuinely new ones are created.
     */
    const ids = [];
    for (const cat of categoriesData) {
      const found = await categoryCollection.findOneAndUpdate(
        { name: cat.name, branch_id: cat.branch_id },
        { $setOnInsert: cat },
        { upsert: true, returnDocument: 'after' }
      );
      const doc = found && (found.value || found);
      if (doc && doc._id) ids.push(doc._id);
    }
    return ids;
  }

  /**
   * Find categories by IDs
   * @param {Array<ObjectId>} categoryIds
   * @param {ObjectId} licenseId
   * @returns {Promise<Array>}
   */
  async findCategoriesByIds(categoryIds, licenseId) {
    const categoryCollection = await this.getCollection('categories');
    return await categoryCollection
      .find({
        _id: { $in: categoryIds },
        license: licenseId,
      })
      .toArray();
  }

  /**
   * Insert a single category
   * @param {Object} categoryData - Category data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertCategory(categoryData) {
    const categoryCollection = await this.getCollection('categories');
    const result = await categoryCollection.insertOne(categoryData);
    return result.insertedId;
  }

  /**
   * Insert multiple items
   * @param {Array} itemsData - Array of item objects
   * @returns {Promise<void>}
   */
  async insertItems(itemsData) {
    if (itemsData.length === 0) return;
    const itemCollection = await this.getCollection('items');
    console.log(`🗄️ Repository: Inserting ${itemsData.length} items into DB...`);
    const result = await itemCollection.insertMany(itemsData);
  }

  /**
   * Insert a single item
   * @param {Object} itemData - Item data to insert
   * @returns {Promise<ObjectId>}
   */
  async insertItem(itemData) {
    const itemCollection = await this.getCollection('items');
    const result = await itemCollection.insertOne(itemData);
    return result.insertedId;
  }

  /**
   * Cleanup all data by license ID
   * Removes all records from all collections that have the specified license
   * @param {ObjectId} licenseId
   * @returns {Promise<Object>}
   */
  async cleanupByLicense(licenseId) {
    const deletionResults = {};
    let totalDeleted = 0;

    for (const collectionName of CLEANUP_COLLECTIONS) {
      try {
        const collection = await this.getCollection(collectionName);
        const result = await collection.deleteMany({ license: licenseId });
        deletionResults[collectionName] = result.deletedCount;
        totalDeleted += result.deletedCount;
      } catch (error) {
        console.error(`Error deleting from ${collectionName}:`, error.message);
        deletionResults[collectionName] = `Error: ${error.message}`;
      }
    }

    return {
      totalDeleted,
      details: deletionResults,
    };
  }
}

module.exports = InstallRepository;

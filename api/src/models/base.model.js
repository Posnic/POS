const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ quiet: true });
const { formatDate } = require('../utils/helpers');
const { getRequestContext } = require('../utils/request-context');
/*
 * Which shop's database this call belongs to.
 *
 * BaseModel.database is a process-wide static, set once when the process
 * connects - correct for a till or a self-hosted server, which have one shop.
 * A process serving several shops needs the handle to follow the request, and
 * currentDb() is what makes that true without threading a database argument
 * through twelve controllers and twelve repositories.
 *
 * In standalone it returns the static and nothing changes. In multi-tenant mode
 * it throws when there is no shop in scope rather than falling back, because
 * falling back is precisely the silent leak: the query would succeed and return
 * another shop's data.
 */
const { currentDb } = require('../db/tenant-context');

/**
 * BaseModel - MongoDB Native Driver Infrastructure
 * Provides static session context and database connection for all models
 */
class BaseModel {
  static _contextFallback = {};

  static _getContextValue(key) {
    const store = getRequestContext();
    return store && Object.prototype.hasOwnProperty.call(store, key)
      ? store[key]
      : (BaseModel._contextFallback[key] ?? null);
  }

  static _setContextValue(key, value) {
    const store = getRequestContext();
    if (store) store[key] = value;
    else BaseModel._contextFallback[key] = value;
  }

  static get loggedUser() {
    return this._getContextValue('loggedUser');
  }
  static set loggedUser(value) {
    this._setContextValue('loggedUser', value);
  }
  static get loggedUserName() {
    return this._getContextValue('loggedUserName');
  }
  static set loggedUserName(value) {
    this._setContextValue('loggedUserName', value);
  }
  static get currentBranch() {
    return this._getContextValue('currentBranch');
  }
  static set currentBranch(value) {
    this._setContextValue('currentBranch', value);
  }
  static get currentBranchName() {
    return this._getContextValue('currentBranchName');
  }
  static set currentBranchName(value) {
    this._setContextValue('currentBranchName', value);
  }
  static get currentBranchCountry() {
    return this._getContextValue('currentBranchCountry');
  }
  static set currentBranchCountry(value) {
    this._setContextValue('currentBranchCountry', value);
  }
  static get currentBranchState() {
    return this._getContextValue('currentBranchState');
  }
  static set currentBranchState(value) {
    this._setContextValue('currentBranchState', value);
  }
  static get currentBranchCity() {
    return this._getContextValue('currentBranchCity');
  }
  static set currentBranchCity(value) {
    this._setContextValue('currentBranchCity', value);
  }
  static get license() {
    return this._getContextValue('license');
  }
  static set license(value) {
    this._setContextValue('license', value);
  }

  // Static session context properties
  static mongoClient = null;
  /* The in-flight connect, shared by everyone who asks while it is running. */
  static _connecting = null;
  /* Which URI the live connection and the in-flight attempt used. MONGODB_URI
     is replaced during startup once credentials are known, and a connection
     made before that is talking to the database as the wrong user. */
  static _connectedUri = null;
  static _connectingUri = null;
  static _connectGeneration = 0;
  static database = null;
  static loggedUserEmail = null;
  static loggedUserDetails = null;
  static currentTax = null;
  static currentTimeZone = null;
  static paymentName = null;
  static paymentKey = null;
  static paymentSecret = null;
  static limit = 10;
  static errorArray = { status: false, data: null, message: 'Error' };
  static successArray = { status: true, data: null, message: 'Success' };

  constructor(collectionName = null) {
    this.collectionName = collectionName;

    if (!BaseModel.mongoClient) {
      /*
       * Start connecting, but do not let a failure here become an unhandled
       * rejection. Since Node 15 an unhandled rejection terminates the process
       * by default, so a database that is slow or refusing connections at the
       * moment a repository is constructed could take the whole API down -
       * on a shop counter, mid-sale.
       *
       * Nothing is hidden by this. The connection attempt is shared, so
       * whoever actually awaits a collection gets the real error with its
       * cause attached; this call only exists to start the work early.
       */
      this.initializeDB().catch(() => {});
    }
  }

  /**
   * Initialize MongoDB connection
   */
  async initializeDB() {
    /*
     * One connection, however many callers arrive at once.
     *
     * This used to call MongoClient.connect() unconditionally, and every
     * caller that arrived while the first was still connecting opened another
     * one. Ten repositories asking for a collection simultaneously - which is
     * exactly what a page load or a concurrent route sweep does - opened
     * twenty clients. BaseModel.mongoClient held the last to finish, so
     * nineteen were left running with nothing referencing them: impossible to
     * close, and each keeping its own pool and re-authenticating for the life
     * of the process.
     *
     * It surfaced as a CI failure rather than as a leak. Driver 7 loads Node's
     * crypto module lazily inside SCRAM-SHA-1 authentication instead of at the
     * top of the file, so when one of those orphans re-authenticated after Jest
     * tore its environment down, require('crypto') returned undefined and the
     * driver read getFips off nothing. Driver 6 had the identical leak and
     * never showed a symptom.
     *
     * Memoising the promise - not the client - is what makes it safe: callers
     * that arrive mid-connect await the same attempt rather than starting
     * their own.
     *
     * The connection is also keyed on the URI, and that part is not an
     * optimisation - it is a bug fix.
     *
     * MONGODB_URI is set twice during startup. main.js sets a bare
     * mongodb://localhost:<port>/PosnicPro as a fallback, and server.js later
     * replaces it with the credentialed URI that setup-mongodb.js validated.
     * Requiring the API's routes constructs repositories, each of which builds
     * a BaseModel, whose constructor starts connecting immediately - with
     * whichever URI is current at that moment, which is the one without a
     * password.
     *
     * Mongoose connects after server.js has swapped the URI, so every
     * mongoose-backed page worked while every native-driver page answered
     * "Command find requires authentication". Sale Reports failed and the
     * dashboard did not, which is a confusing way to be told that two parts of
     * the application are talking to the database as different users.
     *
     * So a URI that differs from the connected one means the old connection is
     * stale: close it and connect again.
     */
    const uri = process.env.MONGODB_URI;

    /*
     * A database that arrived without going through this method belongs to
     * somebody else - install.service.js hands one over after it has finished
     * setting up authentication, and the unit tests inject a mock. _connectedUri
     * is null in both cases, and replacing what they set would be wrong.
     */
    if (BaseModel.database && BaseModel._connectedUri === null) {
      return BaseModel.database;
    }

    if (BaseModel.database && BaseModel._connectedUri === uri) {
      return BaseModel.database;
    }
    if (BaseModel._connecting && BaseModel._connectingUri === uri) {
      return BaseModel._connecting;
    }

    /* Either nothing is connected, or what this method connected used a
       different URI. Drop it - and close it, so it does not sit there
       re-authenticating. */
    const stale = BaseModel.mongoClient;
    BaseModel.mongoClient = null;
    BaseModel.database = null;
    BaseModel._connectedUri = null;
    if (stale) {
      Promise.resolve(stale.close()).catch(() => {
        /* Already gone. */
      });
    }

    BaseModel._connectGeneration += 1;
    const generation = BaseModel._connectGeneration;
    BaseModel._connectingUri = uri;
    BaseModel._connecting = (async () => {
      const client = await MongoClient.connect(uri);
      const superseded =
        BaseModel._connectGeneration !== generation || BaseModel._connectingUri !== uri;
      if (superseded) {
        await Promise.resolve(client.close()).catch(() => {
          /* Already gone. */
        });
        if (BaseModel.database && BaseModel._connectedUri === process.env.MONGODB_URI) {
          return BaseModel.database;
        }
        if (BaseModel._connecting) return BaseModel._connecting;
        throw new Error('Database connection superseded');
      }

      BaseModel.mongoClient = client;
      const dbName = uri.split('/').pop().split('?')[0];
      BaseModel.database = client.db(dbName);
      BaseModel._connectedUri = uri;
      BaseModel._connecting = null;
      BaseModel._connectingUri = null;
      return BaseModel.database;
    })().catch((error) => {
      const superseded =
        BaseModel._connectGeneration !== generation || BaseModel._connectingUri !== uri;
      if (superseded) {
        if (BaseModel.database && BaseModel._connectedUri === process.env.MONGODB_URI) {
          return BaseModel.database;
        }
        if (BaseModel._connecting) return BaseModel._connecting;
        throw error;
      }

      /* Clear it so a later caller can try again rather than being handed a
         permanently rejected promise. */
      BaseModel._connecting = null;
      BaseModel._connectingUri = null;
      console.error('Error connecting to MongoDB:', error);
      throw new Error('Database connection failed', { cause: error });
    });

    return BaseModel._connecting;
  }

  /**
   * Close the connection this class opened.
   *
   * initializeDB() puts a MongoClient on a static and nothing ever took it off
   * again. In the application that is invisible - the process exits and the
   * socket goes with it. Under Jest it is not: the client outlives the suite
   * that created it, keeps re-authenticating in the background, and lands in a
   * torn-down module registry.
   *
   * That went unnoticed until the driver moved to 7, which loads Node's crypto
   * module lazily inside SCRAM-SHA-1 authentication rather than at the top of
   * the file. A require() after teardown returns undefined instead of throwing,
   * so the driver read getFips off nothing and the real-database suite failed
   * to run. Driver 6 had the same leak and never showed it.
   */
  static async closeConnection() {
    const client = BaseModel.mongoClient;
    BaseModel.mongoClient = null;
    BaseModel.database = null;
    BaseModel._connectedUri = null;
    /* Clear the memoised attempt too, or the next caller awaits a promise that
       resolves to a database on a closed client. */
    BaseModel._connecting = null;
    BaseModel._connectingUri = null;
    BaseModel._connectGeneration += 1;
    if (!client) return;
    try {
      await client.close();
    } catch {
      /* Already closed, or never finished connecting. Either way it is gone. */
    }
  }

  /**
   * Get database collection
   */
  async getCollection(collectionName = null) {
    /* Always ask, never assume. initializeDB returns the live database
       untouched when the URI has not changed, and reconnects when it has. */
    await this.initializeDB();

    const targetCollection = collectionName || this.collectionName;
    if (!targetCollection) {
      throw new Error(
        'Collection name is not specified. Pass one explicitly or set it in the model constructor.'
      );
    }

    return currentDb(BaseModel.database).collection(targetCollection);
  }

  /**
   * Get database instance (static)
   */
  static async getDb() {
    await new BaseModel().initializeDB();
    return currentDb(BaseModel.database);
  }

  /**
   * Get database instance (instance method)
   */
  async getDB() {
    await this.initializeDB();
    return currentDb(BaseModel.database);
  }

  setCollectionName(name) {
    this.collectionName = name;
  }

  getCollectionName() {
    return this.collectionName;
  }

  /**
   * Convert value to ObjectId
   */
  toObjectId(value) {
    if (!value) return null;
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && ObjectId.isValid(value)) {
      return new ObjectId(value);
    }
    if (typeof value === 'object' && value._id) {
      return this.toObjectId(value._id);
    }
    return null;
  }

  /**
   * Parse date with timezone (static)
   */
  static startingDate(starting_date, timeZone) {
    const dateStr = String(starting_date);
    const parts = dateStr.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s+(AM|PM)/i);

    if (parts) {
      let [, year, month, day, hour, minute, ampm] = parts;
      hour = parseInt(hour);
      minute = parseInt(minute);

      if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

      const timezoneOffsets = {
        'Asia/Kolkata': 330,
        UTC: 0,
        'America/New_York': -300,
      };

      const resolvedTimeZone = timeZone || BaseModel.currentTimeZone || 'Asia/Kolkata';
      const offsetMinutes = timezoneOffsets[resolvedTimeZone] || 330;

      const localYear = parseInt(year);
      const localMonth = parseInt(month) - 1;
      const localDay = parseInt(day);

      const utcDate = new Date(Date.UTC(localYear, localMonth, localDay, hour, minute, 0, 0));
      utcDate.setMinutes(utcDate.getMinutes() - offsetMinutes);

      return utcDate;
    }

    return new Date(starting_date);
  }

  /**
   * Parse end date with timezone (static)
   */
  static endingDate(ending_date, timeZone) {
    const dateStr = String(ending_date);
    const parts = dateStr.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s+(AM|PM)/i);

    if (parts) {
      let [, year, month, day, hour, minute, ampm] = parts;
      hour = parseInt(hour);
      minute = parseInt(minute);

      if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

      const timezoneOffsets = {
        'Asia/Kolkata': 330,
        UTC: 0,
        'America/New_York': -300,
      };

      const resolvedTimeZone = timeZone || BaseModel.currentTimeZone || 'Asia/Kolkata';
      const offsetMinutes = timezoneOffsets[resolvedTimeZone] || 330;

      const localYear = parseInt(year);
      const localMonth = parseInt(month) - 1;
      const localDay = parseInt(day);

      const utcDate = new Date(Date.UTC(localYear, localMonth, localDay, hour, minute, 0, 0));
      utcDate.setMinutes(utcDate.getMinutes() - offsetMinutes);

      return utcDate;
    }

    return new Date(ending_date);
  }

  /**
   * Instance wrapper for startingDate
   */
  startingDate(starting_date, timeZone) {
    const resolvedTimeZone =
      timeZone || this.timeZone || BaseModel.currentTimeZone || 'Asia/Kolkata';
    return BaseModel.startingDate(starting_date, resolvedTimeZone);
  }

  /**
   * Instance wrapper for endingDate
   */
  endingDate(ending_date, timeZone) {
    const resolvedTimeZone =
      timeZone || this.timeZone || BaseModel.currentTimeZone || 'Asia/Kolkata';
    return BaseModel.endingDate(ending_date, resolvedTimeZone);
  }

  /**
   * Simplify MongoDB document (convert ObjectIds and Dates to strings)
   */
  static simplifyFields(document) {
    if (!document) return document;

    const result = { ...document };

    if (result._id && ObjectId.isValid(result._id)) {
      const idString = result._id.toString();
      result._id = idString;

      if (!result.id) {
        result.id = idString;
      }
    }

    for (const key in result) {
      if (result[key] instanceof ObjectId) {
        result[key] = result[key].toString();
      } else if (result[key] instanceof Date) {
        result[key] = formatDate(result[key]);
      } else if (Array.isArray(result[key])) {
        result[key] = result[key].map((item) => {
          if (item instanceof ObjectId) return item.toString();
          if (item instanceof Date) return formatDate(item);
          if (item && typeof item === 'object') return this.simplifyFields(item);
          return item;
        });
      } else if (result[key] && typeof result[key] === 'object') {
        result[key] = this.simplifyFields(result[key]);
      }
    }

    return result;
  }

  /**
   * Get select fields from schema definition
   */
  static getSelectFields(fields, showAll = false) {
    if (showAll === false) {
      const selectedFields = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value.select === true) {
          selectedFields[key] = 1;
        }
      }
      return selectedFields;
    }
    return fields;
  }

  /**
   * Instance wrapper for getSelectFields
   */
  getSelectFields(fields, showAll = false) {
    return BaseModel.getSelectFields(fields, showAll);
  }

  /**
   * Assign filter objects with proper types
   */
  assignFilterObjects(filters, fields) {
    for (const [filterIndex, filterValue] of Object.entries(filters)) {
      const field = filterIndex.split('.');
      if (field.length > 1) {
        let matches = 0;
        let temp = fields;
        for (const value of field) {
          if (temp && temp[value]) {
            matches++;
            temp = temp[value];
          }
        }

        if (matches === field.length && temp && temp.type) {
          filters = this.assignObj(filterIndex, temp.type, filters);
        }
      } else {
        if (fields[filterIndex] && fields[filterIndex].type) {
          filters = this.assignObj(filterIndex, fields[filterIndex].type, filters);
        }
      }
    }
    return filters;
  }

  /**
   * Assign object by type
   */
  assignObj(index, type, filters) {
    if (type === 'Date') {
      filters[index] = this.assignDateObject(filters[index]);
    } else if (type === 'ObjectId') {
      filters[index] = this.assignObjectId(filters[index]);
    }
    return filters;
  }

  /**
   * Convert filter to Date object
   */
  assignDateObject(filter) {
    const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';

    const toDateInTimeZone = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      const localized = new Date(parsed.toLocaleString('en-US', { timeZone }));
      return localized;
    };

    if (Array.isArray(filter)) {
      return filter.map((value) => toDateInTimeZone(value)).filter((d) => d !== null);
    }

    if (filter && typeof filter === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(filter)) {
        const d = toDateInTimeZone(value);
        if (d) {
          result[key] = d;
        }
      }
      return result;
    }

    return toDateInTimeZone(filter);
  }

  /**
   * Convert filter to ObjectId
   */
  assignObjectId(filter) {
    if (Array.isArray(filter)) {
      return filter.map((value) => new ObjectId(value));
    }
    return new ObjectId(filter);
  }

  /**
   * Check plan limits (PHP-compatible)
   */
  async checkPlan(collection, action, userContext = null) {
    try {
      const user = userContext || BaseModel.loggedUserDetails || null;

      if (user && user.plan_access) {
        const planAccess = user.plan_access;
        const colKey = String(collection || '');
        const actKey = String(action || '');

        if (
          Object.prototype.hasOwnProperty.call(planAccess, colKey) &&
          planAccess[colKey] &&
          Object.prototype.hasOwnProperty.call(planAccess[colKey], actKey)
        ) {
          const value = planAccess[colKey][actKey];
          const num = typeof value === 'string' ? parseInt(value, 10) : value;
          if (!Number.isNaN(num) && typeof num === 'number') {
            return num;
          }
        }
      }

      return -1;
    } catch (e) {
      return -1;
    }
  }

  /**
   * Paginated data fetch
   */
  async page(collectionName, limitCheck = {}, filter = {}, options = {}, fields = null) {
    try {
      const collection = await this.getCollection(collectionName);
      const dbOptions = {
        skip: options.skip ? parseInt(options.skip) : 0,
        limit: options.limit ? parseInt(options.limit) : BaseModel.limit,
        sort: options.sort || { createdAt: -1, updated_date: -1 },
      };

      if (fields) {
        dbOptions.projection = fields;
      }

      const dbOptionLimit = dbOptions.limit;

      if (options.page) {
        dbOptions.skip = Math.max(0, (parseInt(options.page) - 1) * dbOptions.limit);
      }

      if (dbOptions.skip > 0 && dbOptions.limit < limitCheck.limit) {
        dbOptions.limit = Math.min(dbOptions.limit, limitCheck.limit - dbOptions.skip);
      }

      if (BaseModel.license) {
        filter.license = BaseModel.license;
      }

      if (limitCheck.limit > 0 && dbOptions.limit > limitCheck.limit) {
        dbOptions.limit = limitCheck.limit;
      }

      const cursor = await collection.find(filter, dbOptions);
      const countLimit = limitCheck.limit > 0 ? { limit: limitCheck.limit } : {};
      const total = await collection.countDocuments(filter, countLimit);
      const list = await cursor.toArray();

      return {
        status: true,
        data: {
          total,
          current_page: parseInt(options.page) || 1,
          total_pages: Math.ceil(total / dbOptionLimit),
          per_page: dbOptionLimit,
          list: list.map((item) => BaseModel.simplifyFields(item)),
        },
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get single document by ID
   */
  async getOneRow(id, collectionName, fields = null) {
    try {
      if (!id) {
        return {
          status: false,
          data: null,
          message: 'ID is required',
        };
      }

      const collection = await this.getCollection(collectionName);
      const filter = { _id: new ObjectId(id) };

      const licenseId = this.toObjectId(this.licenseId) || BaseModel.license;
      if (licenseId) {
        filter.license = licenseId;
      }

      const options = {};
      if (fields) {
        options.projection = fields;
      }

      let document = await collection.findOne(filter, options);

      if (!document && filter.license) {
        const fallbackFilter = { _id: new ObjectId(id) };
        document = await collection.findOne(fallbackFilter, options);
      }

      if (!document) {
        return {
          status: false,
          data: null,
          message: 'Document Not Found',
        };
      }

      const docWithId = {
        ...document,
        id: document._id ? document._id.toString() : undefined,
      };

      return {
        status: true,
        data: BaseModel.simplifyFields(docWithId),
        message: 'get successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Log data changes
   */
  async changeLog(
    module,
    changedBy,
    documentId,
    operation = 'update',
    oldDocument = null,
    newDocument = null
  ) {
    try {
      await this.initializeDB();

      const collection = currentDb(BaseModel.database).collection('data_change_log');

      const doc = {
        module,
        changed_by: this.toObjectId(changedBy) || changedBy || null,
        docId: this.toObjectId(documentId) || documentId || null,
        operation,
        time: new Date(),
        oldDocument,
        newDocument,
        branch_id: BaseModel.currentBranch || this.branchId || null,
        license: BaseModel.license || this.licenseId || null,
      };

      const result = await collection.insertOne(doc);

      return {
        status: true,
        data: result,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in changeLog:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get all data changes for sync
   */
  async getAllDataChanges(collectionName, module, fromId, fields = null) {
    try {
      await this.initializeDB();

      const changeLogCollection = currentDb(BaseModel.database).collection('data_change_log');

      const query = {
        module: collectionName,
      };

      if (BaseModel.license) {
        query.license = BaseModel.license;
      }

      if (fromId && ObjectId.isValid(fromId)) {
        query._id = { $gt: new ObjectId(fromId) };
      }

      const changes = await changeLogCollection.find(query).sort({ _id: 1 }).limit(100).toArray();

      const result = changes.map((change) => ({
        ...change,
        _id: change._id.toString(),
        docId: change.docId ? change.docId.toString() : null,
        changed_by: change.changed_by ? change.changed_by.toString() : null,
        license: change.license ? change.license.toString() : null,
        branch_id: change.branch_id ? change.branch_id.toString() : null,
      }));

      return {
        status: true,
        data: result,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getAllDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Backup deleted document
   */
  async deletedDocumentBackup(document, params) {
    return BaseModel.deletedDocumentBackup(document, params);
  }

  /**
   * Static backup deleted document
   */
  static async deletedDocumentBackup(document, params) {
    try {
      const backupTable = {
        document_name: document,
        document_backup_date: new Date(),
        ...params,
      };

      if (BaseModel.currentBranch) {
        backupTable.branch_id = BaseModel.currentBranch;
      }
      if (BaseModel.currentBranchName) {
        backupTable.branch_name = BaseModel.currentBranchName;
      }
      if (BaseModel.license) {
        backupTable.license = BaseModel.license;
      }

      const collection = currentDb(BaseModel.database).collection('recycle_bin');
      const insertData = await collection.insertOne(backupTable);

      return {
        status: true,
        data: insertData,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Autocomplete for table field
   */
  async autoSuggestionTableField(field, collectionName, query) {
    const branchId = BaseModel.currentBranch;
    let branchFilter = {};

    if (collectionName === 'users') {
      branchFilter = branchId
        ? {
            'branch_access.branch_id': branchId,
            usertype: { $ne: 'super_admin' },
          }
        : { usertype: { $ne: 'super_admin' } };
    } else if (collectionName === 'branches') {
      const userCollection = await this.getCollection('users');
      const userBranchRecords = await userCollection.findOne({
        _id: BaseModel.loggedUser,
      });

      if (!userBranchRecords) {
        return { status: false, data: [], message: 'User not found' };
      }

      const branchIds = userBranchRecords.branch_access.map((b) => new ObjectId(b.branch_id));
      branchFilter = { _id: { $in: branchIds } };
    } else if (collectionName === 'items') {
      branchFilter = branchId ? { 'branch_access.branch_id': branchId } : {};
    } else if (collectionName === 'variants') {
      // Variants collection doesn't have branch_id, only license
      branchFilter = {};
    } else if (branchId) {
      branchFilter = { branch_id: branchId };
    }

    try {
      const collection = await this.getCollection(collectionName);
      const conditions = [{ [field]: new RegExp(query, 'i') }];

      if (branchFilter && Object.keys(branchFilter).length > 0) {
        conditions.push(branchFilter);
      }

      if (BaseModel.license) {
        conditions.push({ license: BaseModel.license });
      }

      const pipeline = [
        {
          $match: {
            $and: conditions,
          },
        },
        { $limit: 5 },
        { $group: { _id: `$${field}` } },
      ];

      const results = await collection.aggregate(pipeline).toArray();
      const suggestions = results.map((item) => item._id).filter(Boolean);

      return {
        status: true,
        data: suggestions,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in autoSuggestionTableField:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Autocomplete for report table field with branch filter
   */
  async autoSuggestionReportTableField(query, field, collectionName, branchIds) {
    try {
      const collection = await this.getCollection(collectionName);
      const objectIds = Array.isArray(branchIds)
        ? branchIds.map((id) => new ObjectId(id))
        : [new ObjectId(branchIds)];

      const branchFilter =
        collectionName === 'users'
          ? { 'branch_access.branch_id': { $in: objectIds } }
          : { branch_id: { $in: objectIds } };

      const pipeline = [
        {
          $match: {
            $and: [
              { [field]: new RegExp(query, 'i') },
              branchFilter,
              { license: BaseModel.license },
            ],
          },
        },
        { $limit: 5 },
        {
          $project: {
            name: `$${field}`,
            id: { $toString: '$_id' },
          },
        },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      return {
        status: true,
        data: results,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in autoSuggestionReportTableField:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Get default suggestions (name/phone search)
   */
  async getDefaultSuggestion(module, query) {
    try {
      const collection = await this.getCollection(module);
      const branchId = BaseModel.currentBranch;
      const license = BaseModel.license;

      // Build match conditions - only add branch_id and license if they exist
      const matchConditions = [
        {
          $or: [{ name: new RegExp(query, 'i') }, { phone: new RegExp(query, 'i') }],
        },
      ];

      if (branchId) {
        matchConditions.push({ branch_id: branchId });
      }

      if (license) {
        matchConditions.push({ license: license });
      }

      const results = await collection
        .aggregate([
          {
            $match: {
              $and: matchConditions,
            },
          },
          { $limit: 5 },
          {
            $project: {
              id: { $toString: '$_id' },
              name: 1,
              phone: 1,
            },
          },
        ])
        .toArray();

      return {
        status: true,
        data: results,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getDefaultSuggestion:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * CRUD: Find one document
   */
  async findOne(query, options = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (query._id && typeof query._id === 'string') {
        query._id = new ObjectId(query._id);
      }
      if (BaseModel.license) {
        query.license = BaseModel.license;
      }
      return await collection.findOne(query, options);
    } catch (error) {
      console.error('Error in findOne:', error);
      throw error;
    }
  }

  /**
   * CRUD: Find multiple documents
   */
  async find(query = {}, options = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (BaseModel.license) {
        query.license = BaseModel.license;
      }
      return await collection.find(query, options).toArray();
    } catch (error) {
      console.error('Error in find:', error);
      throw error;
    }
  }

  /**
   * CRUD: Insert one document
   */
  async insertOne(document) {
    try {
      const collection = await this.getCollection(this.collectionName);
      document.createdAt = new Date();
      document.updatedAt = new Date();
      if (BaseModel.license) {
        document.license = BaseModel.license;
      }
      const result = await collection.insertOne(document);
      return { ...document, _id: result.insertedId };
    } catch (error) {
      console.error('Error in insertOne:', error);
      throw error;
    }
  }

  /**
   * CRUD: Update one document
   */
  async updateOne(filter, update, options = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (filter._id && typeof filter._id === 'string') {
        filter._id = new ObjectId(filter._id);
      }
      if (BaseModel.license && !filter.license) {
        filter.license = BaseModel.license;
      }

      const updateDoc = {
        $set: {
          ...update.$set,
          updatedAt: new Date(),
        },
        ...(update.$push && { $push: update.$push }),
        ...(update.$pull && { $pull: update.$pull }),
      };

      return await collection.updateOne(filter, updateDoc, options);
    } catch (error) {
      console.error('Error in updateOne:', error);
      throw error;
    }
  }

  /**
   * CRUD: Delete one document
   */
  async deleteOne(filter, options = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (filter._id && typeof filter._id === 'string') {
        filter._id = new ObjectId(filter._id);
      }
      if (BaseModel.license) {
        filter.license = BaseModel.license;
      }
      return await collection.deleteOne(filter, options);
    } catch (error) {
      console.error('Error in deleteOne:', error);
      throw error;
    }
  }

  /**
   * Count documents
   */
  async countDocuments(query = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (BaseModel.license) {
        query.license = BaseModel.license;
      }
      return await collection.countDocuments(query);
    } catch (error) {
      console.error('Error in countDocuments:', error);
      throw error;
    }
  }

  /**
   * Aggregate pipeline
   */
  async aggregate(pipeline) {
    try {
      const collection = await this.getCollection(this.collectionName);
      if (BaseModel.license) {
        pipeline.unshift({ $match: { license: BaseModel.license } });
      }
      return await collection.aggregate(pipeline).toArray();
    } catch (error) {
      console.error('Error in aggregate:', error);
      throw error;
    }
  }

  /**
   * Log user login/branch selection to staff_activities collection
   * PHP: base_model.php changeUserLog()
   * @param {ObjectId|string} userId - User's ObjectId
   * @param {string} userName - User's display name
   * @param {Date} date - Current date
   * @param {ObjectId|string} branchId - Branch ObjectId
   * @param {string} branchName - Branch display name
   * @param {ObjectId|string} license - License ObjectId
   * @param {Object} reqInfo - { userAgent, ip } from the request
   */
  static async changeUserLog(userId, userName, date, branchId, branchName, license, reqInfo = {}) {
    try {
      const db = await BaseModel.getDb();
      const collection = db.collection('staff_activities');

      // Parse user-agent for OS, browser, device (lightweight detection)
      const ua = (reqInfo.userAgent || '').toLowerCase();
      let os = 'Unknown',
        browser = 'Unknown',
        device = 'Desktop';

      // OS detection
      if (ua.includes('windows')) os = 'Windows';
      else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
      else if (ua.includes('linux')) os = 'Linux';
      else if (ua.includes('android')) os = 'Android';
      else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

      // Browser detection
      if (ua.includes('edg/') || ua.includes('edge')) browser = 'Edge';
      else if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
      else if (ua.includes('firefox')) browser = 'Firefox';
      else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
      else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

      // Device detection
      if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone'))
        device = 'Mobile';
      else if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';

      const document = {
        updated_date: date instanceof Date ? date : new Date(),
        os,
        browser,
        device,
        ip: reqInfo.ip || '',
        branch_id: branchId instanceof ObjectId ? branchId : new ObjectId(String(branchId)),
        branch_name: branchName || '',
        user_id: userId instanceof ObjectId ? userId : new ObjectId(String(userId)),
        user_name: userName || '',
        license: license instanceof ObjectId ? license : new ObjectId(String(license)),
      };

      const insertResult = await collection.insertOne(document);
      return { status: true, data: insertResult, message: 'success' };
    } catch (error) {
      console.error('Error in BaseModel.changeUserLog:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Transaction wrapper
   */
  async withTransaction(operations) {
    const session = BaseModel.mongoClient.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await operations(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}

module.exports = BaseModel;

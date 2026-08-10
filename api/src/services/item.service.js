// src/services/item.service.js
const ItemRepository = require('../repositories/item.repository');
const { sanitizeItemData } = require('../helpers/items.helper');
const { ObjectId } = require('mongodb');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../constants/items.constants');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const branchesRepository = require('../repositories/branch.repository');

/**
 * Item Service
 * Contains business logic for item operations
 * Acts as a bridge between controller and repository
 */
class ItemService {
  constructor() {
    this.repository = new ItemRepository();
    this.s3UploadedCache = new Set();
    this.s3UploadQueue = new Set();
    this.s3Client = null;
  }

  shouldUploadToS3() {
    return (process.env.STORAGE_TYPE || 'local') === 's3' && process.env.AWS_S3_BUCKET;
  }

  /*
   * Display-time image normalisation. Never persisted.
   *
   * resolve() turns a loopback URL - true only on the machine that wrote it -
   * into the relative path every origin can serve, and leaves foreign
   * CDN/S3 URLs alone. Anything it does NOT recognise passes through
   * untouched: blanking unknowns is exactly the mistake that once nearly
   * wiped every legacy image at a stroke, and a wrong-but-visible URL beats
   * a silently vanished picture.
   */
  normalizeItemImages(item) {
    if (!item || typeof item !== 'object') return item;
    const { resolve } = require('../utils/image-store');
    const fix = (v) => {
      if (typeof v !== 'string' || !v) return v;
      return resolve(v) || v;
    };
    const out = { ...(typeof item.toObject === 'function' ? item.toObject() : item) };
    out.image = fix(out.image);
    if (Array.isArray(out.multi_image)) {
      out.multi_image = out.multi_image.map((m) =>
        m && typeof m === 'object' ? { ...m, name: fix(m.name) } : m
      );
    }
    return out;
  }

  getPublicBaseUrl({ protocol, host } = {}) {
    const configuredUrl = config.urls?.publicServer || config.cliHost || '';
    const baseUrl = configuredUrl || (protocol && host ? `${protocol}://${host}` : '');
    return baseUrl.replace(/\/+$/, '');
  }

  getS3Client() {
    if (this.s3Client) return this.s3Client;
    if (!this.shouldUploadToS3()) return null;
    this.s3Client = require('../utils/s3').getS3Client();
    return this.s3Client;
  }

  getImageContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.bmp':
        return 'image/bmp';
      default:
        return 'application/octet-stream';
    }
  }

  async uploadFileToS3(filename, filePath) {
    if (!this.shouldUploadToS3()) return null;
    const s3 = this.getS3Client();
    if (!s3 || !fs.existsSync(filePath)) return null;

    try {
      /* No ACL. The bucket enforces bucket-owner ownership with ACLs disabled,
         and S3 rejects any PutObject that carries one - the upload would fail
         and fall back to local disk with nothing but a console line to show
         for it. Public or private is the bucket policy's decision, not ours. */
      const result = await require('../utils/s3').uploadObject({
        key: filename,
        filePath,
        contentType: this.getImageContentType(filename),
      });
      this.s3UploadedCache.add(filename);
      return result;
    } catch (error) {
      console.error('Error uploading image to S3:', error.message);
      return null;
    }
  }

  queueS3Upload(filename, filePath) {
    if (!this.shouldUploadToS3()) return;
    if (this.s3UploadedCache.has(filename) || this.s3UploadQueue.has(filename)) {
      return;
    }

    this.s3UploadQueue.add(filename);
    this.uploadFileToS3(filename, filePath)
      .catch(() => {})
      .finally(() => {
        this.s3UploadQueue.delete(filename);
      });
  }

  /**
   * Get all items with pagination and filters
   * Mirrors the legacy itemPage() behaviour and response shape
   *
   * @param {Object} params
   * @param {string|import("mongodb").ObjectId} params.branchId
   * @param {string|import("mongodb").ObjectId} params.licenseId
   * @param {Object} [params.filters]
   * @param {Object} [params.options]
   */
  async getAllItems({ branchId, licenseId, filters = {}, options = {} } = {}) {
    try {
      if (!branchId || !licenseId) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED,
        };
      }

      const page = parseInt(options.page, 10) || 1;
      const limit = parseInt(options.limit, 10) || 5;
      const sort = options.sort || { _id: -1 };

      const result = await this.repository.findPage({
        branchId,
        licenseId,
        filters,
        page,
        limit,
        sort,
      });

      return {
        status: true,
        data: {
          total: result.total,
          current_page: result.page,
          total_pages: result.totalPages,
          per_page: result.limit,
          list: (result.items || []).map((it) => this.normalizeItemImages(it)),
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.getAllItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Handle saving multiple base64-encoded item images to disk.
   * Mirrors the legacy uploadItemMultiImage controller behaviour but
   * centralises the filesystem work in the service layer.
   *
   * @param {Array} filesArray - Array of file objects from body.items_image
   * @param {Object} options
   * @param {string} options.protocol - Request protocol (http/https)
   * @param {string} options.host - Request host (from req.get("host"))
   * @returns {{status:boolean,data:any,message:string,code?:number}}
   */
  async uploadItemImages(filesArray = [], { protocol, host } = {}) {
    try {
      if (!Array.isArray(filesArray) || filesArray.length === 0) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.NO_FILES_UPLOADED,
          code: 400,
        };
      }

      const allowedExtensions = [
        'gif',
        'GIF',
        'jpg',
        'JPG',
        'png',
        'PNG',
        'jpeg',
        'JPEG',
        'bmp',
        'BMP',
      ];

      const rootDir = path.join(__dirname, '..', '..');
      // Store item images under the API's /uploads directory so that
      // URLs like /uploads/item_images/<file> are served correctly by
      // the existing express static mount and remain compatible with
      // legacy PHP paths.
      const uploadBaseDir = path.join(rootDir, 'uploads');
      const itemImagesDir = path.join(uploadBaseDir, 'item_images');
      const publicDir = path.join(rootDir, 'public');

      if (!fs.existsSync(itemImagesDir)) {
        fs.mkdirSync(itemImagesDir, { recursive: true });
      }

      const returnNames = [];

      for (const fileObj of filesArray) {
        const originalName = fileObj.name || '';
        const size = parseInt(fileObj.size, 10) || 0;
        const cover = fileObj.cover || 'no';
        const data = fileObj.data || '';

        const ext = originalName.includes('.')
          ? originalName.substring(originalName.lastIndexOf('.') + 1)
          : '';

        if (!allowedExtensions.includes(ext)) {
          return {
            status: false,
            data: null,
            // Keep legacy typo to avoid any subtle client-side checks changing
            message: ERROR_MESSAGES.INVALID_IMAGE_TYPE,
            code: 400,
          };
        }

        if (size > 5 * 1024 * 1024) {
          return {
            status: false,
            data: null,
            message: ERROR_MESSAGES.IMAGE_TOO_LARGE,
            code: 400,
          };
        }

        const now = new Date();
        const timestamp =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0') +
          '-' +
          String(now.getHours()).padStart(2, '0') +
          '-' +
          String(now.getMinutes()).padStart(2, '0') +
          '-' +
          String(now.getSeconds()).padStart(2, '0');

        const uniqueId = Math.random().toString(36).slice(2);
        const filename = `${timestamp}-posnic_item_image-${uniqueId}.${ext}`;

        const buffer = Buffer.from(data, 'base64');

        // A request that arrives with no image data used to be written out
        // faithfully as a zero-byte file, stored on the item, and served as a
        // broken picture. Refuse it here, where the caller still gets told.
        if (!buffer.length) {
          return {
            status: false,
            data: null,
            message: ERROR_MESSAGES.NO_FILES_UPLOADED,
            code: 400,
          };
        }

        const fullPath = path.join(itemImagesDir, filename);

        fs.writeFileSync(fullPath, buffer);

        const s3Result = await this.uploadFileToS3(filename, fullPath);

        const rootUploadPath = path.join(uploadBaseDir, filename);
        if (!fs.existsSync(rootUploadPath)) {
          fs.copyFileSync(fullPath, rootUploadPath);
        }

        const publicPath = path.join(publicDir, filename);
        if (!fs.existsSync(publicPath)) {
          fs.copyFileSync(fullPath, publicPath);
        }

        // Store the RELATIVE path, never a full URL.
        //
        // A full URL is only ever true on the machine that wrote it: a till
        // stores http://localhost:42397/... and the moment that row syncs,
        // every other reader's browser is pointed at its own computer. The
        // relative path means "this shop's uploads" on whichever origin is
        // serving - till, subdomain or custom domain - which is what lets one
        // string survive sync in both directions.
        //
        // The S3 result deliberately does not replace the URL either: a
        // bucket-direct URL bakes today's bucket into the row. S3 is the
        // durable copy behind the disk, not the origin the browser reads.
        // s3Result is still awaited so an upload failure is logged before the
        // response goes out.
        const publicUrl = `/uploads/item_images/${filename}`;
        void s3Result;
        void protocol;
        void host;

        returnNames.push({
          name: publicUrl,
          size,
          cover,
        });
      }

      /* Poke the sync agent so the new image crosses to the cloud now, not on
         the next poll. Best effort - see nudge.js. */
      try { require('../sync/nudge').nudgeSyncAgent(); } catch (e) { /* never fail an upload on this */ }

      return {
        status: true,
        data: returnNames,
        message: SUCCESS_MESSAGES.IMAGE_UPLOADED,
      };
    } catch (error) {
      console.error('Error in ItemService.uploadItemImages:', error);
      return {
        status: false,
        data: null,
        message: error.message,
        code: 500,
      };
    }
  }

  /**
   * Load HSN codes from the legacy JSON file.
   * Mirrors the behaviour of getJSONhsncode in the controller but keeps
   * filesystem I/O out of the controller.
   */
  async getHsnCodes() {
    try {
      const jsonPath = path.join(__dirname, '..', 'json', 'hsn.json');

      if (fs.existsSync(jsonPath)) {
        const json = fs.readFileSync(jsonPath, 'utf8');
        const jsonArray = JSON.parse(json);
        return {
          status: true,
          data: jsonArray,
          message: '',
        };
      }

      return {
        status: true,
        data: [],
        message: ERROR_MESSAGES.HSN_FILE_NOT_FOUND,
      };
    } catch (error) {
      console.error('Error in ItemService.getHsnCodes:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create a new item (delegates to legacy itemInsertUpdate via repository)
   */
  async addItem({ data, branchId, licenseId, user } = {}) {
    try {
      const context = {
        branchId,
        licenseId,
        loggedUserId: user?._id || user?.userId || null,
        // Prefer login identifier (username/email) for audit trails and stock logs
        loggedUserName: user?.username || user?.email || user?.name || 'System',
      };
      const sanitized = sanitizeItemData(data || {});
      const result = await this.repository.upsertItem(sanitized, '', context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.addItem:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update an existing item (delegates to legacy itemInsertUpdate via repository)
   */
  async updateItem({ id, data, branchId, licenseId, user } = {}) {
    try {
      const context = {
        branchId,
        licenseId,
        loggedUserId: user?._id || user?.userId || null,
        loggedUserName: user?.name || user?.username || user?.email || 'System',
      };
      const sanitized = sanitizeItemData(data || {});
      const result = await this.repository.upsertItem(sanitized, id, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.updateItem:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete items by IDs (delegates to legacy deleteItemCollectionData)
   */
  async deleteItems({ ids, licenseId, branchId, user } = {}) {
    try {
      const context = {
        licenseId,
        branchId,
        loggedUserId: user?._id || user?.userId || null,
        // Prefer login identifier (username/email) for audit trails and stock logs
        loggedUserName: user?.username || user?.email || user?.name || 'System',
      };
      const result = await this.repository.deleteItems(ids, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.deleteItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getItemsByCategory(categoryId) {
    try {
      const items = await this.repository.getItemsByCategory(categoryId);
      return {
        status: true,
        data: items,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.getItemsByCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * @param {string} query
   * @param {object} [context]  branchId / licenseId / limit - see the
   *                            repository. Optional and additive, so the
   *                            one-argument form is unchanged.
   */
  async searchItems(query, context = {}) {
    try {
      const items = await this.repository.searchItems(query, context);
      return {
        status: true,
        data: items,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.searchItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getItemById(id, context = {}) {
    try {
      const result = await this.repository.getItemTableRow(id, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getItemById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getLowStockItems(params = {}, context = {}) {
    try {
      const result = await this.repository.getLowStockItems(params, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getLowStockItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getOnlineItemsAjaxList(params = {}, context = {}) {
    try {
      const result = await this.repository.getOnlineItemsAjaxList(params, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getOnlineItemsAjaxList:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getOnlineSalesItems(params = {}, context = {}) {
    try {
      const result = await this.repository.getOnlineSalesItems(params, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getOnlineSalesItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async createInstantItem({ data, context } = {}) {
    try {
      const result = await this.repository.createInstantItem(data, context || {});
      return result;
    } catch (error) {
      console.error('Error in ItemService.createInstantItem:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async deleteInstantItem({ id, context } = {}) {
    try {
      const result = await this.repository.deleteInstantItem(id, context || {});
      return result;
    } catch (error) {
      console.error('Error in ItemService.deleteInstantItem:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getReceivingItemsAjaxList(params = {}, context = {}) {
    try {
      const result = await this.repository.getReceivingItemsAjaxList(params, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getReceivingItemsAjaxList:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async accessKiosk(branchStoreId) {
    try {
      const result = await this.repository.accessKiosk(branchStoreId);
      if (result?.status === true && result.data) {
        const rootDir = path.join(__dirname, '..', '..');
        const uploadBaseDir = path.join(rootDir, 'uploads');
        const itemImagesDir = path.join(uploadBaseDir, 'item_images');
        const publicDir = path.join(rootDir, 'public');

        if (!fs.existsSync(itemImagesDir)) {
          fs.mkdirSync(itemImagesDir, { recursive: true });
        }

        const ensureItemImage = async (value, { returnPath = true } = {}) => {
          if (!value || typeof value !== 'string') return value;
          if (value === 'item.svg') return value;

          let pathValue = value;
          if (value.startsWith('http')) {
            try {
              const parsed = new URL(value);
              pathValue = parsed.pathname;
            } catch (err) {
              return value;
            }
          }

          const cleaned = pathValue.replace(/^\/+/, '');
          if (!cleaned) return value;

          const filename = cleaned.split('/').pop();
          if (!filename) return value;

          const itemPath = path.join(itemImagesDir, filename);
          const rootPath = path.join(uploadBaseDir, filename);

          if (fs.existsSync(rootPath) && !fs.existsSync(itemPath)) {
            try {
              fs.copyFileSync(rootPath, itemPath);
            } catch (copyError) {
              console.error('Error copying kiosk image to item_images:', copyError);
            }
          }

          if (fs.existsSync(itemPath) && !fs.existsSync(rootPath)) {
            try {
              fs.copyFileSync(itemPath, rootPath);
            } catch (copyError) {
              console.error('Error copying kiosk image to uploads root:', copyError);
            }
          }

          const publicPath = path.join(publicDir, filename);
          const sourcePath = fs.existsSync(itemPath) ? itemPath : rootPath;
          if (sourcePath && fs.existsSync(sourcePath) && !fs.existsSync(publicPath)) {
            try {
              fs.copyFileSync(sourcePath, publicPath);
            } catch (copyError) {
              console.error('Error copying kiosk image to public root:', copyError);
            }
          }

          if (sourcePath && fs.existsSync(sourcePath) && !this.s3UploadedCache.has(filename)) {
            await this.uploadFileToS3(filename, sourcePath);
          }

          return returnPath ? `/uploads/item_images/${filename}` : filename;
        };

        if (result.data.kiosk_images) {
          result.data.kiosk_images = {
            ...result.data.kiosk_images,
            logo: await ensureItemImage(result.data.kiosk_images.logo, { returnPath: false }),
            banner: await ensureItemImage(result.data.kiosk_images.banner, { returnPath: false }),
            homebanner: await ensureItemImage(result.data.kiosk_images.homebanner, {
              returnPath: false,
            }),
            advertisement: await ensureItemImage(result.data.kiosk_images.advertisement, {
              returnPath: false,
            }),
          };
        }

        if (Array.isArray(result.data.products)) {
          result.data.products = await Promise.all(
            result.data.products.map(async (category) => {
              const items = Array.isArray(category.items)
                ? await Promise.all(
                    category.items.map(async (item) => ({
                      ...item,
                      img: await ensureItemImage(item.img),
                    }))
                  )
                : category.items;
              return { ...category, items };
            })
          );
        }
      }

      return result;
    } catch (error) {
      console.error('Error in ItemService.accessKiosk:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateKioskStatus(id, status) {
    try {
      const result = await this.repository.updateKioskStatus(id, status);
      return result;
    } catch (error) {
      console.error('Error in ItemService.updateKioskStatus:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getItemsByCategoryId(categoryId, context = {}) {
    try {
      const result = await this.repository.getItemsByCategoryId(categoryId, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getItemsByCategoryId:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async itemSearchPage(params = {}, context = {}) {
    try {
      const result = await this.repository.itemSearchPage(params, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.itemSearchPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async accessQr(params = {}) {
    try {
      const result = await this.repository.accessQr(params);
      return result;
    } catch (error) {
      console.error('Error in ItemService.accessQr:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async accessMobileApp(branchId) {
    try {
      const result = await this.repository.accessMobileApp(branchId);
      return result;
    } catch (error) {
      console.error('Error in ItemService.accessMobileApp:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateItemQuantity(id, value) {
    try {
      const result = await this.repository.updateItemQuantity(id, value);
      return result;
    } catch (error) {
      console.error('Error in ItemService.updateItemQuantity:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async categoryProductDetails(data = {}, context = {}) {
    try {
      const result = await this.repository.categoryProductDetails(data, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.categoryProductDetails:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async supplierProductDetails(data = {}, context = {}) {
    try {
      const result = await this.repository.supplierProductDetails(data, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.supplierProductDetails:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getCustomerSearchItems(query, context = {}) {
    try {
      const result = await this.repository.getCustomerSearchItems(query, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getCustomerSearchItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async quantityCount(match = {}) {
    try {
      const { count, listDocs } = await this.repository.getQuantityCount(match);
      return {
        status: true,
        data: { count, listDocs },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.quantityCount:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async categoryItemsReportTable(params = {}) {
    try {
      // Accept both snake_case (from controller) and camelCase for compatibility
      const {
        rawCategoryId,
        category_id,
        rawBranches,
        startingDate,
        starting_date,
        endingDate,
        ending_date,
        licenseId,
        page = 1,
        limit = 5,
      } = params || {};

      // Use snake_case if provided, otherwise camelCase
      const effectiveCategoryId = category_id || rawCategoryId;
      const effectiveStartingDate = starting_date || startingDate;
      const effectiveEndingDate = ending_date || endingDate;

      const effectiveLimit = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 5;
      const effectivePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
      const skip = (effectivePage - 1) * effectiveLimit;

      // Normalize branches input into an array of ObjectIds
      let branches = rawBranches || [];
      if (typeof branches === 'string' && branches.includes(',')) {
        branches = branches
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);
      } else if (!Array.isArray(branches)) {
        branches = [branches];
      }

      const branchIds = branches
        .filter((id) => id && ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      // Build match filter equivalent to legacy controller logic
      const matchConditions = [];

      if (branchIds.length > 0) {
        matchConditions.push({ 'branch_access.branch_id': { $in: branchIds } });
      }

      const dateRange = {};
      if (effectiveStartingDate && effectiveEndingDate) {
        dateRange.updated_date = {
          $gte: new Date(effectiveStartingDate),
          $lte: new Date(effectiveEndingDate),
        };
      }
      if (licenseId) {
        // In legacy controller this was taken directly from BaseLegacyModel.license,
        // which was assigned from req.user.license without ObjectId conversion.
        // To keep behaviour as close as possible, reuse the raw value.
        dateRange.license = licenseId;
      }

      if (Object.keys(dateRange).length > 0) {
        matchConditions.push(dateRange);
      }

      const matchFilter = matchConditions.length > 0 ? { $and: matchConditions } : {};

      if (effectiveCategoryId && ObjectId.isValid(effectiveCategoryId)) {
        matchFilter.category_id = new ObjectId(effectiveCategoryId);
      }

      const paginatedPipeline = [
        { $match: matchFilter },
        {
          $group: {
            _id: {
              category_id: '$category_id',
              category_name: '$category_name',
            },
            selling_price: {
              $sum: {
                $toDouble: { $ifNull: ['$selling_price', 0] },
              },
            },
            item_count: { $sum: 1 },
          },
        },
        { $sort: { selling_price: -1 } },
        { $skip: skip },
        { $limit: effectiveLimit },
      ];

      const countPipeline = [
        { $match: matchFilter },
        {
          $group: {
            _id: {
              category_id: '$category_id',
              category_name: '$category_name',
            },
          },
        },
      ];

      const result = await this.repository.categoryItemsReportTable({
        countPipeline,
        paginatedPipeline,
      });

      const total = result.total || 0;
      const categories = (result.results || []).map((doc) => ({
        category_id: doc._id.category_id ? doc._id.category_id.toString() : '',
        category_name: doc._id.category_name || '',
        selling_price: doc.selling_price || 0,
        item_count: doc.item_count || 0,
      }));

      return {
        status: true,
        data: {
          total,
          current_page: effectivePage,
          total_pages: Math.ceil(total / effectiveLimit),
          per_page: effectiveLimit,
          list: categories,
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in ItemService.categoryItemsReportTable:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async supplierItemsReportTable(params = {}) {
    try {
      // Accept both snake_case (from controller) and camelCase for compatibility
      const {
        rawBranches,
        startingDate,
        starting_date,
        endingDate,
        ending_date,
        supplierId,
        supplier_id,
        licenseId,
        page = 1,
        limit = 5,
      } = params || {};

      // Use snake_case if provided, otherwise camelCase
      const effectiveStartingDate = starting_date || startingDate;
      const effectiveEndingDate = ending_date || endingDate;
      const effectiveSupplierId = supplier_id || supplierId;

      console.log('🔍 Supplier Items Report Service - Dates received:', {
        starting_date,
        startingDate,
        ending_date,
        endingDate,
        effectiveStartingDate,
        effectiveEndingDate,
      });

      const effectiveLimit = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 5;
      const effectivePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
      const skip = (effectivePage - 1) * effectiveLimit;

      // Normalize branches input into an array of ObjectIds
      let branches = rawBranches || [];
      if (typeof branches === 'string' && branches.includes(',')) {
        branches = branches
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);
      } else if (!Array.isArray(branches)) {
        branches = [branches];
      }

      const validBranchIds = branches
        .filter((id) => id && ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const matchFilter = {
        $and: [
          { 'branch_access.branch_id': { $in: validBranchIds } },
          {
            updated_date: {
              $gte: new Date(effectiveStartingDate),
              $lte: new Date(effectiveEndingDate),
            },
          },
        ],
      };

      if (licenseId) {
        const normalizedLicense = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
        matchFilter.$and[1].license = normalizedLicense;
      }

      if (effectiveSupplierId && ObjectId.isValid(effectiveSupplierId)) {
        matchFilter.supplier_id = new ObjectId(effectiveSupplierId);
      }

      const pipeline = [
        { $match: matchFilter },
        {
          $group: {
            _id: {
              supplier_id: '$supplier_id',
              supplier_name: '$supplier_name',
            },
            selling_price: { $sum: '$selling_price' },
            item_count: { $sum: 1 },
          },
        },
        { $sort: { selling_price: -1 } },
        { $skip: skip },
        { $limit: effectiveLimit },
      ];

      const countPipeline = [
        { $match: matchFilter },
        { $group: { _id: { supplier_id: '$supplier_id' } } },
      ];

      const result = await this.repository.supplierItemsReportTable({
        pipeline,
        countPipeline,
      });

      // Flatten the _id object to match PHP response format
      // PHP: $sales_values[$i]['supplier_id'] = $c->_id->supplier_id;
      const flatList = (result.results || []).map((item) => ({
        supplier_id: item._id?.supplier_id || '',
        supplier_name: item._id?.supplier_name || '',
        selling_price: item.selling_price || 0,
        item_count: item.item_count || 0,
      }));

      return {
        status: true,
        data: {
          total: result.total,
          list: flatList,
          current_page: effectivePage,
          per_page: effectiveLimit,
          total_pages: Math.ceil(result.total / effectiveLimit),
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.supplierItemsReportTable:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async itemReportTable(params = {}) {
    try {
      const {
        rawBranches,
        startingDate,
        starting_date,
        endingDate,
        ending_date,
        licenseId,
        page = 1,
        limit = 5,
      } = params || {};

      const effectiveLimit = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 5;
      const effectivePage = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
      const skip = (effectivePage - 1) * effectiveLimit;

      // Use snake_case if provided, otherwise camelCase
      const effectiveStartingDate = starting_date || startingDate;
      const effectiveEndingDate = ending_date || endingDate;

      // Normalize branches input into an array of ObjectIds
      let branches = rawBranches || [];
      if (typeof branches === 'string' && branches.includes(',')) {
        branches = branches
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);
      } else if (!Array.isArray(branches)) {
        branches = [branches];
      }

      const validBranchIds = branches
        .filter((id) => id && ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const matchFilter = {
        $and: [
          { 'branch_access.branch_id': { $in: validBranchIds } },
          {
            updated_date: {
              $gte: new Date(effectiveStartingDate),
              $lte: new Date(effectiveEndingDate),
            },
          },
        ],
      };

      if (licenseId) {
        const normalizedLicense = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
        matchFilter.$and[1].license = normalizedLicense;
      }

      // Check if repository method exists and what arguments it expects
      // Assuming it expects a filter object similar to other report methods
      // If repository method signature is different, this might need adjustment
      const { items, total } = await this.repository.itemReportTable({
        filter: matchFilter,
        skip,
        limit: effectiveLimit,
      });

      return {
        status: true,
        data: {
          list: items,
          total,
          current_page: effectivePage,
          per_page: effectiveLimit,
          total_pages: Math.ceil(total / effectiveLimit),
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.itemReportTable:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async itemStockReportTable(data = {}, context = {}) {
    try {
      const result = await this.repository.itemStockReportTable(data, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.itemStockReportTable:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async importItems(data = [], context = {}) {
    try {
      const result = await this.repository.importItems(data, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.importItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async exportItems(ids = [], context = {}) {
    try {
      const result = await this.repository.exportItems(ids, context);
      return result;
    } catch (error) {
      console.error('Error in ItemService.exportItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async resolveBranchContext({
    userBranchId,
    licenseId,
    currentBranchId = null,
    currentLicenseId = null,
  } = {}) {
    try {
      if (currentBranchId) {
        return {
          branchId: currentBranchId,
          licenseId: currentLicenseId || licenseId || null,
        };
      }

      const hasUserBranch = userBranchId !== undefined && userBranchId !== null;
      const effectiveLicense = currentLicenseId || licenseId !== undefined ? licenseId : null;

      const query = hasUserBranch
        ? { _id: userBranchId }
        : effectiveLicense
          ? { license: effectiveLicense }
          : {};

      if (!query || Object.keys(query).length === 0) {
        return {
          branchId: null,
          licenseId: currentLicenseId || effectiveLicense || null,
        };
      }

      const branchDoc = await branchesRepository.findOne(query, {
        lean: true,
        select: '_id license',
      });

      if (!branchDoc) {
        return {
          branchId: null,
          licenseId: currentLicenseId || effectiveLicense || null,
        };
      }

      const resolvedBranchId =
        branchDoc._id && branchDoc._id.toString ? branchDoc._id.toString() : branchDoc._id;

      const resolvedLicenseId = currentLicenseId || branchDoc.license || effectiveLicense || null;

      return {
        branchId: resolvedBranchId,
        licenseId: resolvedLicenseId,
      };
    } catch (error) {
      console.error('Error in ItemService.resolveBranchContext:', error);
      return {
        branchId: currentBranchId || null,
        licenseId: currentLicenseId || licenseId || null,
      };
    }
  }

  async getBranchNotificationRange(branchId) {
    try {
      if (!branchId) {
        return null;
      }

      const branchDoc = await branchesRepository.findById(branchId, {
        lean: true,
        select: 'notification_range',
      });

      const raw = branchDoc?.notification_range;
      if (raw === undefined || raw === null) {
        return null;
      }

      const trimmed = String(raw).trim();
      if (!trimmed) {
        return null;
      }

      const parsed = parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      console.error('Error in ItemService.getBranchNotificationRange:', error);
      return null;
    }
  }

  async updateItemStock({ itemId, quantityChange } = {}) {
    try {
      if (!itemId) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.ITEM_ID_REQUIRED,
        };
      }

      if (typeof quantityChange !== 'number' || Number.isNaN(quantityChange)) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.INVALID_QUANTITY_CHANGE,
        };
      }

      const dbResult = await this.repository.updateStock(itemId, quantityChange);

      if (!dbResult || dbResult.matchedCount === 0) {
        return {
          status: false,
          data: dbResult,
          message: ERROR_MESSAGES.ITEM_NOT_FOUND,
        };
      }

      const item = await this.repository.findItemById(itemId);

      return {
        status: true,
        data: { result: dbResult, item },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemService.updateItemStock:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
  async getDataChanges(module, from) {
    try {
      const result = await this.repository.getDataChanges(module, from);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get category items report
   * PHP: item_model.php -> categoryItemsReportPage()
   */
  async getCategoryItemsReport(params) {
    try {
      const result = await this.repository.getCategoryItemsReport(params);
      return result;
    } catch (error) {
      console.error('Error in ItemService.getCategoryItemsReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = ItemService;

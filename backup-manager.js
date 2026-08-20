/**
 * Backup Manager for Posnic
 * 
 * Features:
 *   - Daily/Hourly/Weekly scheduled backups
 *   - JSON-based collection exports (gzipped)
 *   - SHA-256 hash-based deduplication (skip if unchanged)
 *   - Configurable retention policy (auto-cleanup old backups)
 *   - Manual backup trigger
 *   - Restore from any backup folder
 * 
 * Storage:
 *   - Config:  <userData>/backup-config.json
 *   - History: <userData>/backup-history.json
 *   - Backups: <user-chosen-path>/posnic-backup-YYYY-MM-DD-HHmmss/
 *     - manifest.json (metadata)
 *     - <collection>.json.gz (one file per collection)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

class BackupManager {
  constructor(options = {}) {
    this.userDataPath = options.userDataPath || process.cwd();
    this.getMongoUri = options.getMongoUri || (() => process.env.MONGODB_URI || `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`);
    this.dbName = options.dbName || 'PosnicPro';
    
    this.configPath = path.join(this.userDataPath, 'backup-config.json');
    this.historyPath = path.join(this.userDataPath, 'backup-history.json');
    
    this.scheduleTimer = null;
    this.isRunning = false;
    
    // Default config
    this.defaultConfig = {
      enabled: false,
      path: this._getDefaultBackupPath(),
      frequency: 'daily',     // 'hourly' | 'daily' | 'weekly'
      time: '02:00',          // HH:MM (24h format)
      dayOfWeek: 0,           // 0-6, 0=Sunday (only for weekly)
      retentionDays: 30,
      lastBackup: null,
      lastBackupHash: null,
      lastBackupSize: 0,
      status: 'idle',         // 'idle' | 'running' | 'success' | 'failed'
      lastError: null
    };
  }

  // ============== CONFIG MANAGEMENT ==============

  _getDefaultBackupPath() {
    try {
      const homeDir = require('os').homedir();
      return path.join(homeDir, 'Documents', 'Posnic-Backups');
    } catch (e) {
      return path.join(this.userDataPath, 'backups');
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        return { ...this.defaultConfig, ...data };
      }
    } catch (err) {
      console.error('[BackupManager] Failed to load config:', err.message);
    }
    return { ...this.defaultConfig };
  }

  saveConfig(config) {
    try {
      const merged = { ...this.loadConfig(), ...config };
      fs.writeFileSync(this.configPath, JSON.stringify(merged, null, 2));
      return merged;
    } catch (err) {
      console.error('[BackupManager] Failed to save config:', err.message);
      throw err;
    }
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      }
    } catch (err) {
      console.error('[BackupManager] Failed to load history:', err.message);
    }
    return [];
  }

  appendHistory(entry) {
    try {
      const history = this.loadHistory();
      history.unshift(entry);
      // Keep only last 200 history entries
      const trimmed = history.slice(0, 200);
      fs.writeFileSync(this.historyPath, JSON.stringify(trimmed, null, 2));
    } catch (err) {
      console.error('[BackupManager] Failed to write history:', err.message);
    }
  }

  // ============== BACKUP OPERATIONS ==============

  /**
   * Run a backup immediately
   * @param {Object} options
   * @param {boolean} options.force - Force backup even if data unchanged
   * @returns {Promise<{success, path, size, skipped, error}>}
   */
  async runBackup(options = {}) {
    if (this.isRunning) {
      return { success: false, error: 'A backup is already in progress' };
    }
    
    this.isRunning = true;
    this.saveConfig({ status: 'running', lastError: null });
    
    const startTime = Date.now();
    const timestamp = this._formatTimestamp(new Date());
    const config = this.loadConfig();
    
    try {
      // Ensure backup root path exists
      if (!fs.existsSync(config.path)) {
        fs.mkdirSync(config.path, { recursive: true });
      }
      
      const backupFolderName = `posnic-backup-${timestamp}`;
      const backupFolder = path.join(config.path, backupFolderName);
      
      console.log(`[BackupManager] Starting backup → ${backupFolder}`);
      
      // Connect to MongoDB and dump all collections
      const { collections, totalDocs, totalSize, dataHash } = await this._dumpDatabase(backupFolder);
      
      // Deduplication: if hash matches last backup, skip
      if (!options.force && config.lastBackupHash && config.lastBackupHash === dataHash) {
        console.log('[BackupManager] No data changes since last backup - skipping');
        // Remove the just-created folder since it's a duplicate
        try { this._deleteFolder(backupFolder); } catch (e) {}
        
        this.appendHistory({
          timestamp: new Date().toISOString(),
          status: 'skipped',
          reason: 'No data changes',
          duration: Date.now() - startTime
        });
        
        this.saveConfig({ 
          status: 'success', 
          lastBackup: new Date().toISOString() 
        });
        
        return { success: true, skipped: true, message: 'No data changes - backup skipped' };
      }
      
      // Write manifest
      // version 2.0 = uses EJSON serialization (preserves BSON types correctly)
      // version 1.0 = legacy plain JSON with broken ObjectId serialization
      const manifest = {
        version: '2.0',
        format: 'ejson',
        timestamp: new Date().toISOString(),
        dbName: this.dbName,
        collections: collections,
        totalDocuments: totalDocs,
        totalSize: totalSize,
        dataHash: dataHash,
        durationMs: Date.now() - startTime
      };
      
      fs.writeFileSync(
        path.join(backupFolder, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      // Update config
      this.saveConfig({
        status: 'success',
        lastBackup: new Date().toISOString(),
        lastBackupHash: dataHash,
        lastBackupSize: totalSize
      });
      
      // Append to history
      this.appendHistory({
        timestamp: manifest.timestamp,
        status: 'success',
        path: backupFolder,
        collections: collections.length,
        totalDocuments: totalDocs,
        size: totalSize,
        hash: dataHash,
        duration: manifest.durationMs
      });
      
      // Clean up old backups based on retention
      this._cleanupOldBackups(config.path, config.retentionDays);
      
      console.log(`[BackupManager] ✅ Backup complete: ${collections.length} collections, ${totalDocs} docs, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      
      return {
        success: true,
        path: backupFolder,
        collections: collections.length,
        totalDocuments: totalDocs,
        size: totalSize,
        duration: manifest.durationMs
      };
    } catch (err) {
      console.error('[BackupManager] ❌ Backup failed:', err.message);
      
      this.saveConfig({
        status: 'failed',
        lastError: err.message
      });
      
      this.appendHistory({
        timestamp: new Date().toISOString(),
        status: 'failed',
        error: err.message,
        duration: Date.now() - startTime
      });
      
      return { success: false, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Dump all MongoDB collections to backup folder
   * @returns {Promise<{collections, totalDocs, totalSize, dataHash}>}
   */
  async _dumpDatabase(backupFolder) {
    const { MongoClient } = require('mongodb');
    const uri = this.getMongoUri();
    
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    
    await client.connect();
    
    try {
      // Ensure folder exists
      if (!fs.existsSync(backupFolder)) {
        fs.mkdirSync(backupFolder, { recursive: true });
      }
      
      const db = client.db(this.dbName);
      const collectionsList = await db.listCollections().toArray();
      
      // Filter out system collections
      const userCollections = collectionsList.filter(c => 
        !c.name.startsWith('system.') && c.type === 'collection'
      );
      
      const collectionsInfo = [];
      let totalDocs = 0;
      let totalSize = 0;
      const allHashes = [];
      
      // Use MongoDB's Extended JSON (EJSON) to preserve BSON types:
      // ObjectId, Date, Decimal128, Binary, etc. survive the JSON roundtrip.
      // Plain JSON.stringify breaks ObjectIds (calls toJSON -> hex string)
      // which causes login/branch lookups to fail after restore.
      const { EJSON } = require('bson');
      
      for (const collInfo of userCollections) {
        const collName = collInfo.name;
        
        try {
          const docs = await db.collection(collName).find({}).toArray();
          totalDocs += docs.length;
          
          // Canonical EJSON (relaxed: false) preserves all BSON types
          const json = EJSON.stringify(docs, { relaxed: false }, 2);
          
          // Compute hash for this collection's data
          const collHash = crypto.createHash('sha256').update(json).digest('hex');
          allHashes.push(`${collName}:${collHash}`);
          
          // Compress and write
          const filePath = path.join(backupFolder, `${collName}.json.gz`);
          const compressed = zlib.gzipSync(json);
          fs.writeFileSync(filePath, compressed);
          
          const size = compressed.length;
          totalSize += size;
          
          collectionsInfo.push({
            name: collName,
            documents: docs.length,
            size: size,
            hash: collHash
          });
          
          console.log(`[BackupManager]   ✓ ${collName}: ${docs.length} docs, ${(size / 1024).toFixed(1)} KB`);
        } catch (err) {
          console.error(`[BackupManager]   ✗ Failed to dump ${collName}:`, err.message);
          collectionsInfo.push({
            name: collName,
            error: err.message
          });
        }
      }
      
      // Combined hash for whole database (for dedup check)
      const dataHash = crypto
        .createHash('sha256')
        .update(allHashes.sort().join('|'))
        .digest('hex');
      
      return {
        collections: collectionsInfo,
        totalDocs,
        totalSize,
        dataHash
      };
    } finally {
      await client.close();
    }
  }

  /**
   * JSON replacer for ObjectId and Date
   */
  _jsonReplacer(key, value) {
    if (value && typeof value === 'object') {
      // ObjectId from BSON
      if (value._bsontype === 'ObjectID' || value._bsontype === 'ObjectId') {
        return { __type: 'ObjectId', value: value.toString() };
      }
      // Date
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() };
      }
      // Buffer/Binary
      if (value._bsontype === 'Binary') {
        return { __type: 'Binary', value: value.buffer.toString('base64') };
      }
    }
    return value;
  }

  /**
   * JSON reviver for ObjectId and Date (for restore)
   */
  static _jsonReviver(key, value) {
    if (value && typeof value === 'object' && value.__type) {
      const { ObjectId, Binary } = require('mongodb');
      switch (value.__type) {
        case 'ObjectId':
          return new ObjectId(value.value);
        case 'Date':
          return new Date(value.value);
        case 'Binary':
          return new Binary(Buffer.from(value.value, 'base64'));
      }
    }
    return value;
  }

  /**
   * Repair a legacy (v1) backup document where ObjectIds were serialized as
   * plain hex strings and Dates as ISO strings. Walks the document tree and
   * converts known patterns back to proper BSON types so mongoose queries
   * (which are strict about types) work correctly after restore.
   * 
   * Heuristics:
   *   - 24-char hex string in _id, *_id, license, branch_id fields => ObjectId
   *   - ISO 8601 date string in *_date, createdAt, updatedAt fields => Date
   */
  static _repairLegacyDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    
    const { ObjectId } = require('mongodb');
    const HEX24 = /^[0-9a-fA-F]{24}$/;
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
    
    // Field names that should always be ObjectIds when they look like 24-hex
    const ID_FIELDS = new Set([
      '_id', 'license', 'license_id', 'branch_id', 'user_id', 'customer_id',
      'supplier_id', 'item_id', 'category_id', 'tax_id', 'unit_id', 'variant_id',
      'role_id', 'plan_id', 'group_id', 'tax_group_id', 'parent_id'
    ]);
    
    // Field names that look like dates (comprehensive)
    const DATE_FIELDS = new Set([
      'createdAt', 'updatedAt', 'created_at', 'updated_at', 'expires',
      'created_date', 'updated_date', 'sale_date', 'receiving_date',
      'expense_date', 'expiry_date', 'register_date', 'login_date',
      'timestamp', 'date', 'datetime', 'time', 'start_time', 'end_time',
      'paid_at', 'opened_at', 'closed_at', 'modified_at', 'deleted_at'
    ]);
    
    const walk = (obj) => {
      if (Array.isArray(obj)) return obj.map(walk);
      if (!obj || typeof obj !== 'object') return obj;
      // Already-converted types: leave alone
      if (obj instanceof Date) return obj;
      if (obj._bsontype) return obj;
      
      const out = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          // Convert id-like string to ObjectId
          if ((key === '_id' || ID_FIELDS.has(key) || key.endsWith('_id')) && HEX24.test(value)) {
            try {
              out[key] = new ObjectId(value);
              continue;
            } catch (e) {
              out[key] = value;
              continue;
            }
          }
          // Convert any ISO date string to Date (aggressive for type preservation)
          // This ensures dates stay dates even in unexpected field names
          if (ISO_DATE.test(value)) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
              out[key] = d;
              continue;
            }
          }
          out[key] = value;
        } else if (Array.isArray(value)) {
          out[key] = value.map(walk);
        } else if (value && typeof value === 'object') {
          out[key] = walk(value);
        } else {
          out[key] = value;
        }
      }
      return out;
    };
    
    return walk(doc);
  }

  // ============== RESTORE OPERATIONS ==============

  /**
   * Restore database from a backup folder
   * @param {string} backupFolder - Absolute path to backup folder
   * @param {Object} options
   * @param {boolean} options.dropExisting - Drop collections before restore
   * @returns {Promise<{success, restored, error}>}
   */
  async restoreBackup(backupFolder, options = {}) {
    if (this.isRunning) {
      return { success: false, error: 'A backup operation is in progress' };
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      /*
       * Where this may read from - see _mayRestoreFrom.
       *
       * Checked before the folder is even looked at, because the check is about
       * whether we should be reading there at all, not about what is there.
       */
      if (!this._mayRestoreFrom(backupFolder)) {
        throw new Error(
          'Restore is limited to the backup folder or one you choose in the '
          + 'file picker. Use Browse to select this folder first.');
      }

      // Validate backup folder
      if (!fs.existsSync(backupFolder)) {
        throw new Error(`Backup folder not found: ${backupFolder}`);
      }
      
      const manifestPath = path.join(backupFolder, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid backup: manifest.json not found');
      }
      
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const backupSize = this._getFolderSize(backupFolder);
      console.log(`[BackupManager] Restoring backup from ${manifest.timestamp} (${(backupSize / 1024 / 1024).toFixed(2)} MB)`);
      
      // Detect legacy v1 backups (broken ObjectId serialization).
      // Set a flag so we can post-process restored docs to convert string IDs back to ObjectIds.
      const isLegacyBackup = !manifest.version || manifest.version === '1.0' || manifest.format !== 'ejson';
      if (isLegacyBackup) {
        console.warn('[BackupManager] ⚠️  Legacy v1 backup detected - will attempt ID type repair during restore');
      }
      
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(this.getMongoUri());
      await client.connect();
      
      try {
        const db = client.db(this.dbName);
        const restored = [];
        
        for (const collInfo of manifest.collections) {
          if (collInfo.error) {
            console.log(`[BackupManager]   ⊘ Skipping ${collInfo.name} (had error in backup)`);
            continue;
          }
          
          const filePath = path.join(backupFolder, `${collInfo.name}.json.gz`);
          if (!fs.existsSync(filePath)) {
            console.log(`[BackupManager]   ⊘ ${collInfo.name}: file missing, skipping`);
            continue;
          }
          
          try {
            // Read and decompress
            const compressed = fs.readFileSync(filePath);
            const json = zlib.gunzipSync(compressed).toString('utf8');
            
            // Always use EJSON to parse - it handles both:
            //   - New EJSON backups ({"$oid": "...", "$date": "..."}): direct parse
            //   - Legacy string backups (plain hex strings, ISO dates): parse + repair
            const { EJSON } = require('bson');
            let docs = EJSON.parse(json, { relaxed: false });
            
            // For legacy v1 backups where ObjectIds were stored as plain strings
            // and dates as ISO strings, repair them to proper BSON types.
            // This ensures exact type preservation: ObjectId stays ObjectId, Date stays Date.
            if (isLegacyBackup && Array.isArray(docs)) {
              docs = docs.map(d => BackupManager._repairLegacyDoc(d));
            }
            
            const collection = db.collection(collInfo.name);
            
            // Drop existing if requested
            if (options.dropExisting) {
              try {
                await collection.drop();
              } catch (dropErr) {
                // Collection may not exist, ignore
              }
            }
            
            // Insert documents
            if (docs.length > 0) {
              // Insert in batches to avoid memory issues
              const batchSize = 500;
              for (let i = 0; i < docs.length; i += batchSize) {
                const batch = docs.slice(i, i + batchSize);
                await collection.insertMany(batch, { ordered: false });
              }
            }
            
            restored.push({
              name: collInfo.name,
              documents: docs.length
            });
            
            console.log(`[BackupManager]   ✓ ${collInfo.name}: ${docs.length} docs restored`);
          } catch (err) {
            console.error(`[BackupManager]   ✗ Failed to restore ${collInfo.name}:`, err.message);
            restored.push({
              name: collInfo.name,
              error: err.message
            });
          }
        }
        
        const durationMs = Date.now() - startTime;
        const totalDocuments = restored.reduce((sum, r) => sum + (r.documents || 0), 0);
        
        this.appendHistory({
          timestamp: new Date().toISOString(),
          status: 'restored',
          source: backupFolder,
          collections: restored.length,
          totalDocuments: totalDocuments,
          size: backupSize,
          durationMs: durationMs,
          dropExisting: !!options.dropExisting
        });
        
        console.log(`[BackupManager] Restore complete: ${restored.length} collections, ${totalDocuments} docs, ${(backupSize / 1024 / 1024).toFixed(2)} MB, ${(durationMs / 1000).toFixed(1)}s`);
        
        return { 
          success: true, 
          restored, 
          manifest,
          size: backupSize,
          durationMs: durationMs,
          totalDocuments: totalDocuments
        };
      } finally {
        await client.close();
      }
    } catch (err) {
      console.error('[BackupManager] Restore failed:', err.message);
      return { success: false, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * List all available backups in the configured backup path
   * @returns {Promise<Array<{path, name, timestamp, size, manifest}>>}
   */
  listBackups() {
    const config = this.loadConfig();
    const backupRoot = config.path;
    
    if (!fs.existsSync(backupRoot)) {
      return [];
    }
    
    const backups = [];
    const folders = fs.readdirSync(backupRoot).filter(name => 
      name.startsWith('posnic-backup-')
    );
    
    for (const folder of folders) {
      const folderPath = path.join(backupRoot, folder);
      const manifestPath = path.join(folderPath, 'manifest.json');
      
      try {
        const stat = fs.statSync(folderPath);
        if (!stat.isDirectory()) continue;
        
        let manifest = null;
        if (fs.existsSync(manifestPath)) {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }
        
        // Calculate folder size
        const size = this._getFolderSize(folderPath);
        
        backups.push({
          path: folderPath,
          name: folder,
          timestamp: manifest ? manifest.timestamp : stat.mtime.toISOString(),
          size: size,
          collections: manifest ? manifest.collections.length : 0,
          totalDocuments: manifest ? manifest.totalDocuments : 0,
          manifest: manifest
        });
      } catch (err) {
        console.error(`[BackupManager] Error reading backup ${folder}:`, err.message);
      }
    }
    
    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return backups;
  }

  // ============== SCHEDULER ==============

  /**
   * Start the backup scheduler based on current config
   */
  startScheduler() {
    this.stopScheduler();
    
    const config = this.loadConfig();
    if (!config.enabled) {
      console.log('[BackupManager] Scheduler disabled in config');
      return;
    }
    
    console.log(`[BackupManager] Starting scheduler: ${config.frequency} at ${config.time}`);
    
    // Check every minute if it's time to run
    this.scheduleTimer = setInterval(() => {
      this._checkSchedule();
    }, 60 * 1000); // every 1 minute
    
    // Also check immediately on start (catch up if missed)
    setTimeout(() => this._checkSchedule(), 5000);
  }

  stopScheduler() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
      console.log('[BackupManager] Scheduler stopped');
    }
  }

  _checkSchedule() {
    const config = this.loadConfig();
    if (!config.enabled || this.isRunning) return;
    
    const now = new Date();
    const lastBackup = config.lastBackup ? new Date(config.lastBackup) : null;
    
    let shouldRun = false;
    
    switch (config.frequency) {
      case 'hourly': {
        // Run if no backup or last backup was 1+ hour ago
        if (!lastBackup || (now - lastBackup) >= 60 * 60 * 1000) {
          shouldRun = true;
        }
        break;
      }
      case 'daily': {
        const [hh, mm] = (config.time || '02:00').split(':').map(Number);
        const todayScheduled = new Date(now);
        todayScheduled.setHours(hh, mm, 0, 0);
        
        // Run if current time >= scheduled time AND no backup today yet
        if (now >= todayScheduled) {
          if (!lastBackup || lastBackup < todayScheduled) {
            shouldRun = true;
          }
        }
        break;
      }
      case 'weekly': {
        const [hh, mm] = (config.time || '02:00').split(':').map(Number);
        const targetDow = config.dayOfWeek || 0;
        
        if (now.getDay() === targetDow) {
          const todayScheduled = new Date(now);
          todayScheduled.setHours(hh, mm, 0, 0);
          
          if (now >= todayScheduled) {
            // Run only if last backup was before this week's scheduled time
            if (!lastBackup || lastBackup < todayScheduled) {
              shouldRun = true;
            }
          }
        }
        break;
      }
    }
    
    if (shouldRun) {
      console.log('[BackupManager] Scheduled backup time reached - running backup');
      this.runBackup().catch(err => {
        console.error('[BackupManager] Scheduled backup failed:', err.message);
      });
    }
  }

  // ============== UTILITIES ==============

  _formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  _cleanupOldBackups(rootPath, retentionDays) {
    if (!retentionDays || retentionDays <= 0) return;
    
    try {
      const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      const folders = fs.readdirSync(rootPath).filter(n => n.startsWith('posnic-backup-'));
      
      let removedCount = 0;
      for (const folder of folders) {
        const folderPath = path.join(rootPath, folder);
        try {
          const stat = fs.statSync(folderPath);
          if (stat.isDirectory() && stat.mtime.getTime() < cutoff) {
            this._deleteFolder(folderPath);
            removedCount++;
          }
        } catch (e) {
          // Skip on error
        }
      }
      
      if (removedCount > 0) {
        console.log(`[BackupManager] Cleaned up ${removedCount} old backup(s) older than ${retentionDays} days`);
      }
    } catch (err) {
      console.error('[BackupManager] Cleanup error:', err.message);
    }
  }

  _deleteFolder(folderPath) {
    if (fs.rmSync) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } else {
      fs.rmdirSync(folderPath, { recursive: true });
    }
  }

  _getFolderSize(folderPath) {
    let size = 0;
    try {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          size += stat.size;
        } else if (stat.isDirectory()) {
          size += this._getFolderSize(filePath);
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return size;
  }

  /**
   * Record that the user picked this folder in the main process's own dialog.
   *
   * Restore will accept it afterwards. Nothing a renderer sends can get a path
   * onto this list - only main.js calls this, and only with what the OS folder
   * picker returned.
   *
   * @param {string} folder
   */
  grantRestorePath(folder) {
    if (!folder) return;
    if (!this._grantedRestorePaths) this._grantedRestorePaths = new Set();
    this._grantedRestorePaths.add(path.resolve(folder));
  }

  /**
   * May a restore read from here?
   *
   * Either it is inside the configured backup root - the folder this
   * application writes its own backups to - or the user chose it themselves in
   * the dialog. A path the renderer simply made up is neither.
   *
   * @param {string} folder
   * @returns {boolean}
   */
  _mayRestoreFrom(folder) {
    if (!folder) return false;

    const resolved = path.resolve(folder);
    if (this._grantedRestorePaths && this._grantedRestorePaths.has(resolved)) return true;

    // A folder inside one the user picked counts: the dialog selects the parent
    // and the backups sit in dated folders beneath it.
    for (const granted of this._grantedRestorePaths || []) {
      if (this._isInside(granted, resolved)) return true;
    }

    try {
      return this._isInside(this.loadConfig().path, resolved);
    } catch (err) {
      return false;
    }
  }

  /**
   * Is `target` the root itself, or somewhere beneath it?
   *
   * Resolved to absolute paths first, so a relative path or one containing ".."
   * is answered on where it actually lands rather than on how it is spelled.
   *
   * @param {string} root    the directory that is allowed
   * @param {string} target  the directory being asked about
   * @returns {boolean}
   */
  _isInside(root, target) {
    if (!root || !target) return false;

    const from = path.resolve(root);
    const to = path.resolve(target);
    if (from === to) return true;

    const rel = path.relative(from, to);

    // ".." means it climbed out; an absolute result means a different drive.
    return Boolean(rel)
      && !rel.startsWith('..' + path.sep)
      && rel !== '..'
      && !path.isAbsolute(rel);
  }

  /**
   * Delete a specific backup folder
   */
  deleteBackup(backupPath) {
    try {
      const config = this.loadConfig();

      /*
       * Must be inside the configured backup root - checked by walking the
       * path, not by comparing the strings.
       *
       * This was normalize().startsWith(), which passes for any sibling whose
       * name merely begins with the root's: with a root of PosnicBackups, the
       * separate folder PosnicBackups-OLD reads as "inside" and gets deleted.
       * path.relative answers the question actually being asked - it returns a
       * path starting with ".." when the target is somewhere else, and an
       * absolute path when the two are on different drives.
       *
       * This is reached from renderer IPC and it deletes folders recursively,
       * so getting the boundary right is the whole of the safety here.
       */
      if (!this._isInside(config.path, backupPath)) {
        return { success: false, error: 'Invalid backup path (outside backup root)' };
      }

      if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup folder does not exist' };
      }
      
      this._deleteFolder(backupPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = BackupManager;

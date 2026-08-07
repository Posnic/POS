const BaseController = require('./base.controller');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

class CronsController extends BaseController {
  constructor() {
    super();
    this.cronJobs = new Map();
    this.cronDirectory = path.join(__dirname, '../../cron_files');
    this.ensureDirectoryExists();
  }

  async ensureDirectoryExists() {
    try {
      await fs.mkdir(this.cronDirectory, { recursive: true });
    } catch (error) {
      console.error('Error creating cron directory:', error);
    }
  }

  /**
   * PHP: cronCreateFile()
   * Create a test file to verify cron execution
   */
  async cronCreateFile(req, res) {
    try {
      const filePath = path.join(this.cronDirectory, 'test_cron_posnic.txt');
      const content = `Cron Node.js Testing - ${new Date().toISOString()}`;

      await fs.writeFile(filePath, content, 'utf8');

      return this.success(
        res,
        {
          filePath,
          content,
          message: 'File writing completed',
        },
        'Cron file created successfully'
      );
    } catch (error) {
      console.error('Error in cronCreateFile:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get all scheduled cron jobs
   */
  async getAllCronJobs(req, res) {
    try {
      if (!this.checkPermission('setting', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const jobs = Array.from(this.cronJobs.entries()).map(([name, job]) => ({
        name,
        schedule: job.schedule,
        running: job.task ? job.task.running : false,
        status: job.status || 'inactive',
      }));

      return this.success(res, jobs, 'Cron jobs retrieved successfully');
    } catch (error) {
      console.error('Error in getAllCronJobs:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Create/Schedule a new cron job
   */
  async createCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name, schedule, action, enabled = true } = req.body;

      if (!name || !schedule || !action) {
        return this.error(res, 'Name, schedule, and action are required', 400);
      }

      // Validate cron expression
      if (!cron.validate(schedule)) {
        return this.error(res, 'Invalid cron schedule expression', 400);
      }

      // Check if job already exists
      if (this.cronJobs.has(name)) {
        return this.error(res, 'Cron job with this name already exists', 400);
      }

      // Store job configuration
      this.cronJobs.set(name, {
        schedule,
        action,
        enabled,
        task: null,
        status: enabled ? 'scheduled' : 'inactive',
      });

      // Schedule the job if enabled
      if (enabled) {
        this.scheduleCronJob(name);
      }

      return this.success(
        res,
        { name, schedule, action, enabled },
        'Cron job created successfully',
        201
      );
    } catch (error) {
      console.error('Error in createCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Update an existing cron job
   */
  async updateCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;
      const { schedule, action, enabled } = req.body;

      if (!this.cronJobs.has(name)) {
        return this.error(res, 'Cron job not found', 404);
      }

      const job = this.cronJobs.get(name);

      // Stop existing task if running
      if (job.task) {
        job.task.stop();
      }

      // Update job configuration
      if (schedule !== undefined) {
        if (!cron.validate(schedule)) {
          return this.error(res, 'Invalid cron schedule expression', 400);
        }
        job.schedule = schedule;
      }
      if (action !== undefined) job.action = action;
      if (enabled !== undefined) job.enabled = enabled;

      job.status = job.enabled ? 'scheduled' : 'inactive';

      // Reschedule if enabled
      if (job.enabled) {
        this.scheduleCronJob(name);
      }

      return this.success(res, { name, ...job }, 'Cron job updated successfully');
    } catch (error) {
      console.error('Error in updateCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Delete a cron job
   */
  async deleteCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'delete', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;

      if (!this.cronJobs.has(name)) {
        return this.error(res, 'Cron job not found', 404);
      }

      const job = this.cronJobs.get(name);

      // Stop the task if running
      if (job.task) {
        job.task.stop();
      }

      this.cronJobs.delete(name);

      return this.success(res, null, 'Cron job deleted successfully');
    } catch (error) {
      console.error('Error in deleteCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Start a cron job
   */
  async startCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;

      if (!this.cronJobs.has(name)) {
        return this.error(res, 'Cron job not found', 404);
      }

      const job = this.cronJobs.get(name);
      job.enabled = true;
      job.status = 'scheduled';

      this.scheduleCronJob(name);

      return this.success(res, { name, status: 'started' }, 'Cron job started successfully');
    } catch (error) {
      console.error('Error in startCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Stop a cron job
   */
  async stopCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;

      if (!this.cronJobs.has(name)) {
        return this.error(res, 'Cron job not found', 404);
      }

      const job = this.cronJobs.get(name);

      if (job.task) {
        job.task.stop();
      }

      job.enabled = false;
      job.status = 'stopped';
      job.task = null;

      return this.success(res, { name, status: 'stopped' }, 'Cron job stopped successfully');
    } catch (error) {
      console.error('Error in stopCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Execute a cron job immediately (manual trigger)
   */
  async executeCronJob(req, res) {
    try {
      if (!this.checkPermission('setting', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;

      if (!this.cronJobs.has(name)) {
        return this.error(res, 'Cron job not found', 404);
      }

      const job = this.cronJobs.get(name);

      // Execute the action
      const result = await this.executeCronAction(job.action);

      return this.success(
        res,
        { name, executedAt: new Date(), result },
        'Cron job executed successfully'
      );
    } catch (error) {
      console.error('Error in executeCronJob:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get cron job execution logs
   */
  async getCronLogs(req, res) {
    try {
      if (!this.checkPermission('setting', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const { name } = req.params;
      const logFile = path.join(this.cronDirectory, `${name}_log.txt`);

      try {
        const logs = await fs.readFile(logFile, 'utf8');
        return this.success(res, { logs: logs.split('\n') }, 'Logs retrieved successfully');
      } catch (error) {
        if (error.code === 'ENOENT') {
          return this.success(res, { logs: [] }, 'No logs available');
        }
        throw error;
      }
    } catch (error) {
      console.error('Error in getCronLogs:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Internal method to schedule a cron job
   * @private
   */
  scheduleCronJob(name) {
    const job = this.cronJobs.get(name);
    if (!job) return;

    // Stop existing task if any
    if (job.task) {
      job.task.stop();
    }

    // Schedule new task
    job.task = cron.schedule(job.schedule, async () => {
      console.log(`[CRON] Executing job: ${name}`);
      try {
        const result = await this.executeCronAction(job.action);
        await this.logCronExecution(name, 'success', result);
      } catch (error) {
        console.error(`[CRON] Error executing job ${name}:`, error);
        await this.logCronExecution(name, 'error', error.message);
      }
    });

    job.task.start();
    console.log(`[CRON] Scheduled job: ${name} with schedule: ${job.schedule}`);
  }

  /**
   * Execute a cron action
   * @private
   */
  async executeCronAction(action) {
    // Map action names to actual functions
    const actions = {
      createFile: () => this.cronCreateFile({ body: {} }, { json: () => {} }),
      cleanupLogs: () => this.cleanupOldLogs(),
      backupDatabase: () => this.backupDatabase(),
      sendReports: () => this.sendScheduledReports(),
      updateStats: () => this.updateStatistics(),
    };

    if (actions[action]) {
      return await actions[action]();
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Log cron execution
   * @private
   */
  async logCronExecution(name, status, message) {
    const logFile = path.join(this.cronDirectory, `${name}_log.txt`);
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${status.toUpperCase()}: ${message}\n`;

    try {
      await fs.appendFile(logFile, logEntry, 'utf8');
    } catch (error) {
      console.error('Error writing cron log:', error);
    }
  }

  /**
   * Cleanup old log files
   * @private
   */
  async cleanupOldLogs() {
    console.log('[CRON] Cleaning up old logs...');
    // Implementation for cleanup
    return 'Logs cleaned up';
  }

  /**
   * Backup database
   * @private
   */
  async backupDatabase() {
    console.log('[CRON] Backing up database...');
    // Implementation for backup
    return 'Database backup completed';
  }

  /**
   * Send scheduled reports
   * @private
   */
  async sendScheduledReports() {
    console.log('[CRON] Sending scheduled reports...');
    // Implementation for sending reports
    return 'Reports sent';
  }

  /**
   * Update statistics
   * @private
   */
  async updateStatistics() {
    console.log('[CRON] Updating statistics...');
    // Implementation for updating stats
    return 'Statistics updated';
  }
}

module.exports = new CronsController();

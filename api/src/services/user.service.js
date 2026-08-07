const usersRepository = require('../repositories/user.repository');
const UserModel = require('../models/user.model');
const Branch = require('../models/branch.model');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { ERROR_MESSAGES } = require('../constants/users.constants');

class UsersService {
  constructor() {
    this.repository = usersRepository;
    this.userModel = UserModel;
  }

  async createUser(userData, context) {
    try {
      const response = await this.userModel.userInsertUpdate(userData, '', context);
      return response;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateUser(userId, userData, context) {
    try {
      const response = await this.userModel.userInsertUpdate(userData, userId, context);
      return response;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getUserById(userId, options = {}) {
    try {
      const user = await this.repository.findById(userId, options);

      if (!user) {
        return {
          status: false,
          data: null,
          message: 'User not found',
        };
      }

      if (!user.registers) user.registers = [];
      if (!user.branch_access) user.branch_access = [];

      return {
        status: true,
        data: user,
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

  async getUsersList(filters, options, context) {
    try {
      const result = await this.repository.getUserPage(filters, options, context);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async deleteUsers(userIds, context) {
    try {
      const objectIds = userIds.map((id) => new ObjectId(id));

      const condition = {
        _id: { $in: objectIds },
        license: context.license,
      };

      const usersToDelete = await this.repository.find(condition, { lean: true });

      if (usersToDelete.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No users found to delete',
        };
      }

      const deleteResult = await this.repository.deleteMany(condition);

      return {
        status: true,
        data: deleteResult.deletedCount,
        message: 'User deleted successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async authenticateUser(username, password) {
    try {
      const loginId = String(username).trim().toLowerCase();

      const user = await this.repository.findOne(
        {
          $or: [{ email: loginId }, { username: loginId }],
        },
        {
          select:
            '+password +license +branch_access +printing_design +access +plan +plan_access +activate +firstname +lastname +username +email +image +register_status +usertype',
          lean: true,
        }
      );

      if (!user) {
        return {
          status: 'incorrect',
          data: null,
          message: 'Incorrect username or password',
        };
      }

      const base64Password = Buffer.from(password).toString('base64');
      let passwordValid = await bcrypt.compare(base64Password, user.password);

      if (!passwordValid) {
        passwordValid = await bcrypt.compare(password, user.password);
      }

      if (!passwordValid) {
        return {
          status: 'incorrect',
          data: null,
          message: 'Incorrect username or password',
        };
      }

      const branchAccess = Array.isArray(user.branch_access) ? user.branch_access : [];

      if (branchAccess.length === 0) {
        return {
          status: 'none',
          data: null,
          message: ERROR_MESSAGES.NO_BRANCHES,
        };
      }

      /*
       * The password hash does not leave this method.
       *
       * findOne is asked for +password so bcrypt can compare it, and the whole
       * user object was then handed back to the caller with the hash still on
       * it - into controllers that serialise it into responses and sessions. It
       * has done its job by this point.
       */
      const { password: _hash, ...safeUser } = user;

      return {
        status: true,
        data: safeUser,
        message: 'Authentication successful',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getUserBranches(userId, license) {
    try {
      const result = await this.repository.getUserBranchList(userId, license);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateUserProfile(userId, profileData, license) {
    try {
      const result = await this.repository.updateUserProfileImage(userId, profileData, license);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updatePrintSettings(userId, currentBranch, printData) {
    try {
      const result = await this.repository.updatePrintSetting(userId, currentBranch, printData);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getPrintTypes(userId) {
    try {
      const result = await this.repository.getPrintType(userId);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getRegisterList(currentBranch, license) {
    try {
      const result = await this.repository.getUserRegisterList(currentBranch, license);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async verifyAdminPassword(userId, password, currentBranch, license) {
    try {
      const result = await this.repository.verifyUserPassword(
        userId,
        password,
        currentBranch,
        license
      );
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async resetPassword(userkey, newPassword, retypePassword) {
    try {
      const result = await this.repository.updateUserPassword(userkey, newPassword, retypePassword);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async verifyResetKey(userkey) {
    try {
      const result = await this.repository.getUserByKey(userkey);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getUserAjaxSuggestions(query, currentBranch, license) {
    try {
      const result = await this.repository.getUserAjaxList(query, currentBranch, license);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getUserStatusReport(data, options) {
    try {
      const result = await this.repository.getUserStatusReportPage(data, options);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async exportUsers(userIds, license) {
    try {
      const result = await this.repository.exportUserOrder(userIds, license);
      return result;
    } catch (error) {
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
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateBranchName(branchId, branchName, license) {
    try {
      const modifiedCount = await this.repository.updateUserBranchName(
        branchId,
        branchName,
        license
      );

      return {
        status: true,
        data: modifiedCount,
        message: 'Branch name updated successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async removeUserImage(userId, imagePath, license) {
    try {
      const result = await this.repository.removeUserImage(userId, imagePath, license);
      return result;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async changeBranch(branchId, userId, licenseId) {
    try {
      const mongoose = require('mongoose');
      const {
        DEFAULTS,
        ERROR_MESSAGES,
        SUCCESS_MESSAGES,
      } = require('../constants/users.constants');

      if (!mongoose.Types.ObjectId.isValid(branchId)) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.INVALID_BRANCH_ID,
        };
      }

      const branch = await Branch.findOne({
        _id: branchId,
        license: licenseId,
      }).lean();

      if (!branch) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.BRANCH_NOT_FOUND,
        };
      }

      // Persist the active branch so stateless JWT/API requests resolve the
      // same branch even when no express-session cookie is available. The
      // filter re-validates both license ownership and branch access.
      const userUpdate = await this.repository.updateOne(
        {
          _id: userId,
          license: licenseId,
          'branch_access.branch_id': branch._id,
        },
        {
          $set: {
            branch: branch._id,
            branch_id: branch._id,
          },
        }
      );
      if (userUpdate && userUpdate.matchedCount === 0) {
        return {
          status: false,
          data: null,
          message: 'You do not have access to the selected branch',
        };
      }

      let customerData = {
        name: DEFAULTS.CUSTOMER_NAME,
        phone: DEFAULTS.CUSTOMER_PHONE,
        email: DEFAULTS.CUSTOMER_EMAIL,
        address: DEFAULTS.CUSTOMER_ADDRESS,
      };

      if (branch.default_customer) {
        const defaultCustomer = await this.repository.findCustomerById(branch.default_customer, {
          branchId: branch._id,
          branchName: branch.branch_name || '',
          licenseId: branch.license || licenseId,
        });
        if (defaultCustomer) {
          customerData = {
            name: defaultCustomer.name || DEFAULTS.CUSTOMER_NAME,
            phone: defaultCustomer.phone || DEFAULTS.CUSTOMER_PHONE,
            email: defaultCustomer.email || DEFAULTS.CUSTOMER_EMAIL,
            address: defaultCustomer.address || DEFAULTS.CUSTOMER_ADDRESS,
          };
        }
      }

      const responseData = {
        user_id: String(userId),
        branch_logo: branch.logo || DEFAULTS.BRANCH_IMAGE,
        branch_id: String(branch._id),
        branch_name: branch.branch_name || '',
        license: String(branch.license || licenseId || ''),
        branch_phone: branch.store_telephone || '',
        branch_email: branch.store_email || '',
        branch_address: branch.store_address || '',
        customer_name: customerData.name,
        customer_phone: customerData.phone,
        customer_email: customerData.email,
        customer_address: customerData.address,
      };

      return {
        status: true,
        data: responseData,
        message: SUCCESS_MESSAGES.BRANCH_CHANGED,
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async ssoAuthentication(token) {
    try {
      const { ERROR_MESSAGES } = require('../constants/users.constants');

      const ssoRecord = await this.repository.findActiveSsoToken(token);

      if (!ssoRecord) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.INVALID_SSO_TOKEN,
        };
      }

      const currentDate = new Date();
      if (ssoRecord.expire_date && new Date(ssoRecord.expire_date) <= currentDate) {
        return {
          status: false,
          data: null,
          message: 'SSO token has expired',
        };
      }

      /* ssoCollection was never declared in this file - the name belongs to the
         repository, which owns the sso collection. This threw ReferenceError,
         so a single-use SSO token was never retired and stayed valid until it
         expired on its own. */
      await this.repository.deactivateSsoToken(token);

      const user = await this.repository.findOne(
        {
          email: ssoRecord.email,
          license: ssoRecord.license,
        },
        {
          select:
            '+password +branch_access +printing_design +access +plan +plan_access +activate +license +firstname +lastname +username +email +image +register_status +usertype',
          lean: true,
        }
      );

      if (!user) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.USER_NOT_FOUND,
        };
      }

      const branchAccess = Array.isArray(user.branch_access) ? user.branch_access : [];

      if (branchAccess.length === 0) {
        return {
          status: 'none',
          data: null,
          message: ERROR_MESSAGES.NO_BRANCHES,
        };
      }

      return {
        status: true,
        data: user,
        message: 'SSO authentication successful',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async generateSsoToken(email, timezone) {
    try {
      const crypto = require('crypto');
      const { ERROR_MESSAGES, AUTH } = require('../constants/users.constants');

      const userDetails = await this.repository.findOne({ email }, { lean: true });

      if (!userDetails) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.USER_NOT_FOUND,
        };
      }
      const tz = timezone || 'UTC';
      const currentDate = new Date();
      const expireDate = new Date(
        currentDate.getTime() + AUTH.SSO_TOKEN_EXPIRE_MINUTES * 60 * 1000
      );

      const apiKey = crypto.randomBytes(16).toString('hex');
      const secret = crypto.randomBytes(32).toString('hex');
      const base64UrlHeader = Buffer.from(apiKey)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const base64UrlPayload = Buffer.from(secret)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const signature = crypto
        .createHmac('sha256', email)
        .update(base64UrlHeader + '.' + base64UrlPayload)
        .digest('hex');
      const base64UrlSignature = Buffer.from(signature)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const token = base64UrlHeader + '.' + base64UrlPayload + '.' + base64UrlSignature;

      const ssoData = {
        token: token,
        email: userDetails.email,
        license: userDetails.license,
        timezone: tz,
        status: 'active',
        created_at: currentDate,
        expire_at: expireDate,
      };

      await this.repository.createSsoToken(ssoData);

      return {
        status: true,
        data: { token },
        message: 'SSO token generated successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateUserPlan(license, email, planData) {
    try {
      const mongoose = require('mongoose');

      const parsedPlanAccess =
        typeof planData.plan_access === 'string'
          ? JSON.parse(planData.plan_access)
          : planData.plan_access;

      const expireDate = new Date(planData.plan_expire);

      await this.userModel.updateOne(
        {
          license: mongoose.Types.ObjectId.isValid(license)
            ? new mongoose.Types.ObjectId(license)
            : license,
          email: email,
        },
        {
          $set: {
            'plan.name': planData.name,
            'plan.max_sales': planData.max_sales,
            'plan.plan_expire': expireDate,
            'access.plan.read': planData.access === 'true' || planData.access === true,
            plan_access: parsedPlanAccess,
          },
        }
      );

      return {
        status: true,
        data: null,
        message: 'Plan updated successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async mobileLogin(username, password) {
    try {
      const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../constants/users.constants');
      const myusername = String(username).trim();
      const mypassword = Buffer.from(String(password).trim()).toString('base64');

      const user = await this.repository.findOne(
        {
          $or: [{ username: myusername }, { email: myusername }],
        },
        { select: '+password +branch_access +activate +license', lean: true }
      );

      if (!user) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.USER_NOT_FOUND,
        };
      }

      if (!user.activate) {
        return {
          status: false,
          data: null,
          message: 'User account is not activated',
        };
      }

      const passwordValid = await bcrypt.compare(mypassword, user.password);

      if (!passwordValid) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.INVALID_PASSWORD,
        };
      }

      if (!user.activate) {
        return {
          status: 'incorrect',
          data: null,
          message: 'Invalid credentials or inactive account',
        };
      }

      return {
        status: true,
        data: user.branch_access || [],
        message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async kioskLogin(username, password) {
    try {
      const mongoose = require('mongoose');
      const { SUCCESS_MESSAGES } = require('../constants/users.constants');

      const myusername = String(username).trim();
      const mypassword = Buffer.from(String(password).trim()).toString('base64');

      const user = await this.repository.findOne(
        {
          $or: [{ username: myusername }, { email: myusername }],
        },
        { select: '+password +branch_access +activate +license +username', lean: true }
      );

      if (!user) {
        return {
          status: 'incorrect',
          data: null,
          message: 'Invalid credentials',
        };
      }

      const passwordValid = await bcrypt.compare(mypassword, user.password);

      if (!passwordValid || !user.activate) {
        return {
          status: 'incorrect',
          data: null,
          message: 'Invalid credentials or inactive account',
        };
      }

      const branchAccess = user.branch_access || [];
      const branchIds = branchAccess.map((b) =>
        mongoose.Types.ObjectId.isValid(b.branch_id)
          ? new mongoose.Types.ObjectId(b.branch_id)
          : b.branch_id
      );

      const kioskMap = {};

      if (branchIds.length > 0) {
        const cursor = await this.repository.findBranchesWithKiosk(branchIds);

        for (const doc of cursor) {
          if (doc.kiosk && Array.isArray(doc.kiosk)) {
            for (const kioskEntry of doc.kiosk) {
              if (!kioskEntry.branch_id) continue;

              const bid = String(kioskEntry.branch_id);
              kioskMap[bid] = {
                store_id: kioskEntry.store_id || null,
                user_id: String(user._id),
                user_name: user.username || null,
                payment_cod: kioskEntry.payment_cod || null,
                payment_number: kioskEntry.payment_number || null,
                payment_razorpay: kioskEntry.payment_razorpay || null,
              };
            }
          }
        }
      }

      const joinedBranches = branchAccess.map((b) => {
        const branchIdStr = String(b.branch_id);
        const row = {
          branch_id: branchIdStr,
          branch_name: b.branch_name || '',
          branch_image: b.branch_image || '',
        };

        if (kioskMap[branchIdStr]) {
          const k = kioskMap[branchIdStr];
          if (k.store_id) row.store_id = k.store_id;
          if (k.user_id) row.user_id = String(k.user_id);
          if (k.user_name) row.user_name = k.user_name;
          if (k.payment_cod !== null) row.payment_cod = Boolean(k.payment_cod);
          if (k.payment_number !== null) row.payment_number = Boolean(k.payment_number);
          if (k.payment_razorpay !== null) row.payment_razorpay = Boolean(k.payment_razorpay);
        }

        return row;
      });

      const filteredBranches = joinedBranches.filter((row) => row.store_id);

      return {
        status: true,
        data: filteredBranches,
        message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = new UsersService();

const User = require('../models/user.model');
const Branch = require('../models/branch.model');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

class UsersRepository {
  constructor() {
    this.userModel = User;
    this.branchModel = Branch;
  }

  async findById(id, options = {}) {
    let query = this.userModel.findById(id);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.lean) {
      query = query.lean();
    }

    return await query;
  }

  async findOne(filter, options = {}) {
    let query = this.userModel.findOne(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.lean) {
      query = query.lean();
    }

    return await query;
  }

  async find(filter, options = {}) {
    let query = this.userModel.find(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.skip) {
      query = query.skip(options.skip);
    }

    if (options.lean) {
      query = query.lean();
    }

    return await query;
  }

  async countDocuments(filter) {
    return await this.userModel.countDocuments(filter);
  }

  async create(userData) {
    return await this.userModel.create(userData);
  }

  async updateOne(filter, update, options = {}) {
    return await this.userModel.updateOne(filter, update, options);
  }

  async updateMany(filter, update, options = {}) {
    return await this.userModel.updateMany(filter, update, options);
  }

  async deleteMany(filter) {
    return await this.userModel.deleteMany(filter);
  }

  async findByIdAndUpdate(id, update, options = {}) {
    return await this.userModel.findByIdAndUpdate(id, update, options);
  }

  async getUserPage(filters, options, context) {
    return await this.userModel.userPage(filters, options, context);
  }

  async getUserStatusReportPage(data, options) {
    return await this.userModel.userstatusReportPage(data, options);
  }

  async getDataChanges(module, from) {
    return await this.userModel.getDataChanges(module, from);
  }

  async exportUserOrder(data, license) {
    return await this.userModel.exportUserOrder(data, license);
  }

  async userInsertUpdate(data, id, context) {
    return await this.userModel.userInsertUpdate(data, id, context);
  }

  async getUserAjaxList(query, currentBranch, license) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const usersCollection = db.collection('users');

      const where = {
        username: new RegExp(query, 'i'),
        'branch_access.branch_id': new ObjectId(currentBranch),
        license: new ObjectId(license),
      };

      const data = await usersCollection.find(where).limit(5).toArray();

      const users = data.map((item) => ({
        userid: item._id.toString(),
        name: item.username,
        registerid: item.register_id ? item.register_id.toString() : '',
        registername: item.register_name || '',
      }));

      return {
        status: true,
        data: users,
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

  async updatePrintSetting(userId, currentBranch, printData) {
    try {
      const updateResult = await this.userModel.updateOne(
        {
          _id: new ObjectId(userId),
          'printing_design.branch_id': new ObjectId(currentBranch),
        },
        {
          $set: {
            'printing_design.$.printing_design': printData.print_type,
            'printing_design.$.printing_max_char': printData.print_character,
            'printing_design.$.printing_size': printData.print_size,
          },
        }
      );

      return {
        status: true,
        data: updateResult.modifiedCount,
        message: 'Print setting updated successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: 'Print setting update failed',
      };
    }
  }

  async getPrintType(userId) {
    try {
      const user = await this.findById(userId, { lean: true });

      if (!user) {
        throw new Error('User not found');
      }

      const printStatus = user.preference?.printing_design;

      return {
        status: true,
        data: printStatus,
        message: 'Print setting retrieved successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: 'Print setting retrieval failed',
      };
    }
  }

  async getUserRegisterList(currentBranch, license) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const branchCollection = db.collection('branches');

      const filters = {
        $and: [{ _id: new ObjectId(currentBranch), license: new ObjectId(license) }],
      };

      const userList = await branchCollection
        .aggregate([
          { $unwind: '$register' },
          { $match: filters },
          {
            $group: {
              _id: {
                register_id: '$register.register_id',
                register_name: '$register.register_name',
              },
            },
          },
        ])
        .toArray();

      const userValues = userList.map((doc) => ({
        register_id: doc._id.register_id.toString(),
        register_name: doc._id.register_name,
      }));

      return {
        status: true,
        data: userValues,
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

  async verifyUserPassword(userId, password, currentBranch, license) {
    try {
      const user = await this.findOne(
        {
          'branch_access.branch_id': new ObjectId(currentBranch),
          _id: new ObjectId(userId),
          license: new ObjectId(license),
        },
        { select: '+password +usertype', lean: true }
      );

      if (!user) {
        return {
          status: false,
          data: null,
          message: 'User not found',
        };
      }

      const base64Password = Buffer.from(password).toString('base64');
      const isValid = await bcrypt.compare(base64Password, user.password);

      if (isValid && user.usertype === 'super_admin') {
        return {
          status: true,
          data: null,
          message: 'Valid Admin',
        };
      } else {
        return {
          status: false,
          data: null,
          message: 'Invalid Admin Password',
        };
      }
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateUserBranchName(branchId, branchName, license) {
    try {
      const updateResult = await this.userModel.updateMany(
        {
          'branch_access.branch_id': new ObjectId(branchId),
          license: new ObjectId(license),
        },
        {
          $set: {
            'branch_access.$.branch_name': branchName,
          },
        }
      );

      return updateResult.modifiedCount;
    } catch (error) {
      throw error;
    }
  }

  async updateUserProfileImage(userId, imageData, license) {
    try {
      await this.userModel.updateOne(
        {
          _id: new ObjectId(userId),
          license: new ObjectId(license),
        },
        {
          $set: {
            image: imageData.image.trim(),
            firstname: imageData.name.trim(),
            lastname: imageData.lastname.trim(),
          },
        }
      );

      const profileDetails = {
        imagename: imageData.image,
        firstname: imageData.name.trim(),
        lastname: imageData.lastname.trim(),
      };

      return {
        status: true,
        data: profileDetails,
        message: 'User details update successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async removeUserImage(userId, image, license) {
    try {
      await this.userModel.updateOne(
        {
          _id: new ObjectId(userId),
          license: new ObjectId(license),
        },
        {
          $set: {
            image: image,
          },
        }
      );

      return {
        status: true,
        data: image,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async getUserBranchList(userId, license) {
    try {
      const user = await this.findOne(
        {
          _id: new ObjectId(userId),
          license: new ObjectId(license),
        },
        { lean: true }
      );

      if (!user) {
        throw new Error('User not found');
      }

      const userBranch = [];
      const branchAccess = user.branch_access || [];

      for (const value of branchAccess) {
        const userPrintRecords = await this.findOne(
          {
            'printing_design.branch_id': value.branch_id,
          },
          { lean: true }
        );

        if (userPrintRecords && userPrintRecords.printing_design) {
          const printType = userPrintRecords.printing_design;

          for (const val of printType) {
            if (value.branch_id.toString() === val.branch_id.toString()) {
              userBranch.push({
                branch_access: value.branch_id.toString(),
                branch_name: value.branch_name,
                branch_image: value.branch_image,
                printing_design: val.printing_design,
                printing_max_char: val.printing_max_char || 'default',
                printing_size: val.printing_size || 'receipt_medium',
              });
            }
          }
        }
      }

      return {
        status: true,
        data: userBranch,
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

  async getUserByKey(userkey) {
    try {
      const user = await this.findOne({ userkey }, { lean: true });

      if (!user) {
        return {
          status: 'empty',
          data: null,
          message: 'Your key deactivated, please contact posnic admin !',
        };
      }

      const currentDate = new Date();
      if (user.expire_date && user.expire_date <= currentDate) {
        return {
          status: false,
          data: null,
          message: 'Your link expired, please contact posnic admin !',
        };
      }

      return {
        status: true,
        data: user.userkey,
        message: 'User Key Verified Successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: 'Your key deactivated, please contact posnic admin !',
      };
    }
  }

  async updateUserPassword(retypePassword, newPassword, userkey) {
    try {
      const user = await this.userModel.findOne({ userkey }).select('+password').lean();

      if (!user || user.userkey !== userkey) {
        return {
          status: 'exist',
          data: null,
          message: 'Already used this link, please contact posnic admin !.',
        };
      }

      if (newPassword !== retypePassword) {
        return {
          status: false,
          data: null,
          message: 'Password mismatch',
        };
      }

      const base64Password = Buffer.from(newPassword).toString('base64');
      const hashedPassword = await bcrypt.hash(base64Password, 12);

      const isOldPassword = await bcrypt.compare(base64Password, user.password);
      if (isOldPassword) {
        return {
          status: 'exist',
          data: null,
          message: 'This password already exist. Please choose another',
        };
      }

      const random = new Date().toLocaleDateString('en-GB').replace(/\//g, '') + Math.random();
      const newUserkey = await bcrypt.hash(random, 10);

      await this.userModel.updateOne(
        { userkey },
        {
          $set: {
            password: hashedPassword,
            userkey: newUserkey,
          },
        }
      );

      return {
        status: 'success',
        data: null,
        message: 'Password successfully updated',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  // Collection access methods - for collections not mapped to Mongoose models
  async findCustomerById(customerId, context = {}) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const customersCollection = db.collection('customers');
      return await customersCollection.findOne({
        _id: new ObjectId(String(customerId)),
        ...(context.branchId ? { branch_id: new ObjectId(String(context.branchId)) } : {}),
        ...(context.branchName ? { branch_name: context.branchName } : {}),
        ...(context.licenseId ? { license: new ObjectId(String(context.licenseId)) } : {}),
      });
    } catch (error) {
      console.warn('Error fetching customer:', error.message);
      return null;
    }
  }

  async findActiveSsoToken(token) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const ssoCollection = db.collection('sso');
      return await ssoCollection.findOne({ token, status: 'active' });
    } catch (error) {
      console.warn('Error fetching SSO token:', error.message);
      return null;
    }
  }

  /**
   * Retire a single-use SSO token once it has been exchanged for a session.
   *
   * The service used to do this itself, reaching for a `ssoCollection` variable
   * that only ever existed in this file - so the token was never actually
   * deactivated and the call threw ReferenceError. Which means an SSO link
   * stayed usable after it had been used, until it expired on time.
   */
  async deactivateSsoToken(token) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const ssoCollection = db.collection('sso');
      return await ssoCollection.updateOne(
        { token, status: 'active' },
        { $set: { status: 'deactive' } }
      );
    } catch (error) {
      console.warn('Error deactivating SSO token:', error.message);
      return null;
    }
  }

  async createSsoToken(ssoData) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const ssoCollection = db.collection('sso');
      const result = await ssoCollection.insertOne(ssoData);
      return result.insertedId;
    } catch (error) {
      throw new Error('Failed to create SSO token: ' + error.message, { cause: error });
    }
  }

  async findBranchesWithKiosk(branchIds) {
    try {
      const mongoose = require('mongoose');
      const db = mongoose.connection.db;
      const branchCollection = db.collection('branches');
      return await branchCollection
        .find({
          'kiosk.branch_id': { $in: branchIds },
        })
        .toArray();
    } catch (error) {
      console.warn('Error fetching branches with kiosk:', error.message);
      return [];
    }
  }
}

module.exports = new UsersRepository();

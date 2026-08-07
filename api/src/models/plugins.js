// src/models/plugins.js
require('mongoose');

/**
 * A mongoose schema plugin that adds toJSON transformation
 * to remove __v, _id and convert id to string
 */
const toJSON = (schema) => {
  let transform;
  if (schema.options.toJSON && schema.options.toJSON.transform) {
    transform = schema.options.toJSON.transform;
  }

  schema.options.toJSON = {
    ...schema.options.toJSON,
    transform(doc, ret, options) {
      // Remove the _id and __v from every document before returning the result
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;

      // Call the custom transform function if it exists
      if (transform) {
        return transform(doc, ret, options);
      }
    },
  };
};

/**
 * A mongoose schema plugin to add pagination
 * Adds paginate static method to the schema
 */
const paginate = (schema) => {
  /**
   * @typedef {Object} QueryResult
   * @property {Document[]} results - Results found
   * @property {number} page - Current page
   * @property {number} limit - Maximum number of results per page
   * @property {number} totalPages - Total number of pages
   * @property {number} totalResults - Total number of documents
   */
  /**
   * Query for documents with pagination
   * @param {Object} [filter] - Mongo filter
   * @param {Object} [options] - Query options
   * @param {string} [options.sortBy] - Sorting criteria using the format: sortField:(desc|asc). Multiple sorting criteria should be separated by commas (,)
   * @param {string|number} [options.limit] - Maximum number of results per page (default = 10)
   * @param {string|number} [options.page] - Current page (default = 1)
   * @returns {Promise<QueryResult>}
   */
  schema.statics.paginate = async function (filter, options) {
    let sort;
    if (options.sortBy) {
      const sortingCriteria = [];
      options.sortBy.split(',').forEach((sortOption) => {
        const [key, order] = sortOption.split(':');
        sortingCriteria.push((order === 'desc' ? '-' : '') + key);
      });
      sort = sortingCriteria.join(' ');
    } else {
      sort = 'createdAt';
    }

    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;

    const countPromise = this.countDocuments(filter).exec();
    let docsPromise = this.find(filter).sort(sort).skip(skip).limit(limit);

    // If populate is specified ensure we can handle string, array, or object definitions
    if (options.populate) {
      const populateQueue = Array.isArray(options.populate)
        ? options.populate
        : typeof options.populate === 'string'
          ? options.populate
              .split(',')
              .map((field) => field.trim())
              .filter(Boolean)
          : [options.populate];

      populateQueue.forEach((populateOption) => {
        if (typeof populateOption === 'string') {
          docsPromise = docsPromise.populate(
            populateOption
              .split('.')
              .map((segment) => segment.trim())
              .filter(Boolean)
              .reverse()
              .reduce((acc, segment) => {
                if (!acc) {
                  return { path: segment };
                }
                return { path: segment, populate: acc };
              }, null)
          );
        } else if (populateOption && typeof populateOption === 'object') {
          docsPromise = docsPromise.populate(populateOption);
        }
      });
    }

    docsPromise = docsPromise.exec();

    return Promise.all([countPromise, docsPromise]).then((values) => {
      const [totalResults, results] = values;
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        results,
        page,
        limit,
        totalPages,
        totalResults,
      };
      return Promise.resolve(result);
    });
  };
};

module.exports = {
  toJSON,
  paginate,
};

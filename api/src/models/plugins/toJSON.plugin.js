const toJSON = (schema) => {
  let transform;
  if (schema.options.toJSON && schema.options.toJSON.transform) {
    transform = schema.options.toJSON.transform;
  }

  schema.options.toJSON = Object.assign(schema.options.toJSON || {}, {
    transform(doc, ret, options) {
      // Remove the _id and __v fields from the output
      delete ret._id;
      delete ret.__v;

      // Remove any field that has `private: true` in the schema
      Object.keys(ret).forEach((key) => {
        if (schema.path(key) && schema.path(key).options && schema.path(key).options.private) {
          delete ret[key];
        }
      });

      // Transform _id to id
      ret.id = doc._id.toString();
      delete ret._id;

      // Apply custom transform if provided
      if (transform) {
        return transform(doc, ret, options);
      }

      return ret;
    },
  });
};

module.exports = toJSON;

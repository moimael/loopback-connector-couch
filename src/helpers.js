// helpers
export default class Helpers {
  static optimizeSettings(settings) {
    settings.hostname = settings.hostname || settings.host || '127.0.0.1';
    settings.protocol = settings.protocol || 'http';
    settings.port = settings.port || 5984;
    settings.database = settings.database || settings.db;
    if (!settings.database) {
      throw new Error('Database name must be specified in dataSource for CouchDB connector');
    }
  }

  static merge(base, update) {
    if (!base) {
      return update;
    }
    if (!_.isArray(base)) {
      _.extend(base, update);
    } else {
      _.each(base, function(doc) {
        return _.extend(doc, update);
      });
    }
    return base;
  }

  static reverse(key) {
    var hasOrder;
    if (hasOrder = key.match(/\s+(A|DE)SC$/i)) {
      if (hasOrder[1] === 'DE') {
        return -1;
      }
    }
    return 1;
  }

  static stripOrder(key) {
    return key.replace(/\s+(A|DE)SC/i, '');
  }

  static savePrep(model, data) {
    var id;
    if (id = data.id) {
      data._id = id.toString();
    }
    delete data.id;
    if (data._rev === null) {
      delete data._rev;
    }
    if (model) {
      data.loopbackModel = model;
    }
    return;
  }

  static undoPrep(data) {
    var _id;
    if (_id = data._id) {
      data.id = _id.toString();
    }
    delete data._id;
    delete data.loopbackModel;
    return;
  }

  static designName(modelName) {
    return 'loopback_' + modelName;
  }

  static viewName(propName) {
    return 'by_' + propName;
  }

  static invokeCallbackOrLogError(callback, err, res) {
    // When callback exists let it handle the error and result
    if (callback) {
      return callback && callback(err, res);
    } else if (err) {
      // Without a callback we can at least log the error
      return console.log(err);
    }
  }

  static updateDesign(db, designName, design, callback) {
    // Add the design document to the database or update it if it already exists.
    return db.get(designName, (err, designDoc) => {
      if (err && err.error !== 'not_found') {
        return helpers.invokeCallbackOrLogError(callback, err, designDoc);
      }

      // Update the design doc
      if (!designDoc) {
        designDoc = design;
      } else {
        // We only update the design when its views have changed - this avoids rebuilding the views.
        if (_.isEqual(designDoc.views, design.views)) {
          return helpers.invokeCallbackOrLogError(callback, null, designDoc);
        }
        designDoc.views = design.views;
      }

      // Insert the design doc into the database.
      return db.insert(designDoc, designName, (err, insertedDoc) => {
        return helpers.invokeCallbackOrLogError(callback, err, insertedDoc);
      });
    });
  }
};

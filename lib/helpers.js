'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var _require = require('lodash');

var _ = _require._;

// Helpers

module.exports = function () {
  function Helpers() {
    _classCallCheck(this, Helpers);
  }

  _createClass(Helpers, null, [{
    key: 'optimizeSettings',
    value: function optimizeSettings(settings) {
      settings.hostname = settings.hostname || settings.host || '127.0.0.1';
      settings.protocol = settings.protocol || 'http';
      settings.port = settings.port || 5984;
      settings.database = settings.database || settings.db;
      if (!settings.database) {
        throw new Error('Database name must be specified in dataSource for CouchDB connector');
      }
    }
  }, {
    key: 'merge',
    value: function merge(base, update) {
      if (!base) {
        return update;
      }
      if (!_.isArray(base)) {
        _.extend(base, update);
      } else {
        _.each(base, function (doc) {
          return _.extend(doc, update);
        });
      }
      return base;
    }
  }, {
    key: 'reverse',
    value: function reverse(key) {
      var hasOrder;
      if (hasOrder = key.match(/\s+(A|DE)SC$/i)) {
        if (hasOrder[1] === 'DE') {
          return -1;
        }
      }
      return 1;
    }
  }, {
    key: 'stripOrder',
    value: function stripOrder(key) {
      return key.replace(/\s+(A|DE)SC/i, '');
    }
  }, {
    key: 'savePrep',
    value: function savePrep(model, data) {
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
  }, {
    key: 'undoPrep',
    value: function undoPrep(data) {
      var _id;
      if (_id = data._id) {
        data.id = _id.toString();
      }
      delete data._id;
      delete data.loopbackModel;
      return;
    }
  }, {
    key: 'designName',
    value: function designName(modelName) {
      return 'loopback_' + modelName;
    }
  }, {
    key: 'viewName',
    value: function viewName(propName) {
      return 'by_' + propName;
    }
  }, {
    key: 'invokeCallbackOrLogError',
    value: function invokeCallbackOrLogError(callback, err, res) {
      // When callback exists let it handle the error and result
      if (callback) {
        return callback && callback(err, res);
      } else if (err) {
        // Without a callback we can at least log the error
        return console.log(err);
      }
    }
  }, {
    key: 'updateDesign',
    value: function updateDesign(db, designName, design, callback) {
      // Add the design document to the database or update it if it already exists.
      return db.get(designName, function (err, designDoc) {
        if (err && err.error !== 'not_found') {
          return Helpers.invokeCallbackOrLogError(callback, err, designDoc);
        }

        // Update the design doc
        if (!designDoc) {
          designDoc = design;
        } else {
          // We only update the design when its views have changed - this avoids rebuilding the views.
          if (_.isEqual(designDoc.views, design.views)) {
            return Helpers.invokeCallbackOrLogError(callback, null, designDoc);
          }
          designDoc.views = design.views;
        }

        // Insert the design doc into the database.
        return db.insert(designDoc, designName, function (err, insertedDoc) {
          return Helpers.invokeCallbackOrLogError(callback, err, insertedDoc);
        });
      });
    }
  }]);

  return Helpers;
}();
//# sourceMappingURL=helpers.js.map

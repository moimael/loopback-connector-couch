var {_} = require('lodash');
var debug = require('debug')('loopback:connector:couch');
var helpers = require('./helpers.js');

// api
exports.initialize = function(dataSource, callback) {
  var connector = new CouchConnector(dataSource, callback);

  if (callback) {
    dataSource.connector.connect(callback);
  }
};

//Constructor and useful reference functions
class CouchConnector {
  constructor(dataSource) {

    var ref;
    var ref1;
    var ref2;
    this.relational = false;
    this.dataSource = dataSource;
    dataSource.connector = this;

    var settings = dataSource.settings || {};
    this.settings = settings;
    helpers.optimizeSettings(settings);

    if (((ref = settings.auth) != null) ? ref.reader : undefined) {
      this._nanoReader = require('nano')(this.buildAuthUrl(settings.auth.reader));
    }
    if (((ref1 = settings.auth) != null) ? ref1.writer : undefined) {
      this._nanoWriter = require('nano')(this.buildAuthUrl(settings.auth.writer));
    }
    if (((ref2 = settings.auth) != null) ? ref2.admin : undefined) {
      this._nanoAdmin = require('nano')(this.buildAuthUrl(settings.auth.admin));
    }

    if (!this._nanoReader) {
      this._nanoReader = require('nano')(this.buildAuthUrl(settings.auth));
    }
    if (!this._nanoWriter) {
      this._nanoWriter = require('nano')(this.buildAuthUrl(settings.auth));
    }
    if (!this._nanoAdmin) {
      this._nanoAdmin = require('nano')(this.buildAuthUrl(settings.auth));
    }

    this._models = {};
    this.name = 'couchdb';
    if (settings.views && _.isArray(settings.views)) {
      this.DataAccessObject = function() {};
      //add existing methods
      if (dataSource.constructor.DataAccessObject) {
        for (var k in dataSource.constructor.DataAccessObject) {
          var v = dataSource.constructor.DataAccessObject[k];
          this.DataAccessObject[k] = v;
        }
        for (var k in dataSource.constructor.DataAccessObject.prototype) {
          v = dataSource.constructor.DataAccessObject.prototype[k];
          this.DataAccessObject.prototype[k] = v;
        }
      }
      //then add connector method
      var viewFn = this.buildViewEndpoint(settings.views);
      this.DataAccessObject.queryView = viewFn;
      dataSource.queryView = viewFn;
    }

    return this;
  }

  getDefaultIdType() {
    return String;
  }

  getTypes() {
    return ['db', 'nosql', 'couchdb'];
  }

  getMetadata() {
    if (!this._metaData) {
      this._metaData = {
        types: this.getTypes(),
        defaultIdType: this.getDefaultIdType(),
        isRelational: this.relational,
        schemaForSettings: {}
      };
    }
    return this._metaData;
  }

  define(descr) {
    var modelName = descr.model.modelName;

    this._models[modelName] = descr;
    descr.properties._rev = {
      type: String
    };
    // Add index views for schemas that have indexes
    var design = {
      views: {}
    };
    var hasIndexes = false;
    for (var propName in descr.properties) {
      var value = descr.properties[propName];
      if (value.index) {
        hasIndexes = true;
        var viewName = helpers.viewName(propName);
        design.views[viewName] = {
          map: 'function (doc) { if (doc.loopbackModel === \'' + modelName + '\' && doc.'+propName + ') return emit(doc.' + propName + ', null); }'
        };
      }
    }
    if (hasIndexes) {
      var designName = '_design/' + helpers.designName(modelName);
      return helpers.updateDesign(this._nanoAdmin, designName, design);
    }
  }

//Loopback.io prototype functions
  connect(callback) {
    var design = {
      views: {
        by_model: {
          map: 'function (doc) { if (doc.loopbackModel) return emit(doc.loopbackModel, null); }'
        }
      }
    };

    helpers.updateDesign(this._nanoAdmin, '_design/loopback', design, (err, res) => {
      return callback && callback(err, res);
    });
  };

  create(model, data, callback) {
    debug('CouchDB create');
    return this.save(model, data, callback);
  }

  save(model, data, callback) {
    debug('CouchDB save');
    if (!data) {
      return callback && callback('Cannot create an empty document in the database');
    }
    delete data._deleted;     // Prevents accidental deletion via save command
    return this._nanoWriter.insert(this.forDB(model, data), (err, rsp) => {
      if (err) {
        return callback(err);
      }
      // Undo the effects of savePrep as data object is the only one
      // that the Loopback.io can access.
      helpers.undoPrep(data);
      // Update the data object with the revision returned by CouchDb.
      data._rev = rsp.rev;
      return callback && callback(null, rsp.id, rsp.rev);
    });
  }

  updateOrCreate(model, data, callback) {
    debug('CouchDB updateOrCreate');
    delete data._deleted;    // Prevents accidental deletion
    return this.save(model, data, function(err, id, rev) {
      if (err) {
        return callback && callback(err);
      }
      data.id = id;
      data._rev = rev;
      return callback && callback(null, data);
    });
  }

  update(model, where, data, callback) {
    debug('CouchDB update');
    delete data._deleted;    // Prevents accidental deletion
    return this.all(model, {where}, (err, docsFromDb) => {
      if (err) {
        return callback && callback(err);
      }
      helpers.merge(docsFromDb, data);
      if (!_.isArray(docsFromDb)) {
        docsFromDb = [docsFromDb];
      }
      var docs = ((() => {
        var result = [];
        for (var i = 0, doc; i < docsFromDb.length; i++) {
          doc = docsFromDb[i];
          result.push(this.forDB(model, doc));
        }
        return result;
      })());
      debug(docs);
      return this._nanoWriter.bulk({docs}, function(err, rsp) {
        return callback && callback(err, rsp);
      });
    });
  }

  updateAttributes(model, id, attributes, callback) {
    debug('CouchDB updateAttributes');
    delete attributes._deleted;  //prevent accidental deletion
    return this._nanoReader.get(id, (err, doc) => {
      if (err) {
        return callback && callback(err);
      }
      return this.save(model, helpers.merge(doc, attributes), function(err, rsp) {
        if (err) {
          return callback && callback(err);
        }
        doc._rev = rsp.rev;
        return callback && callback(null, doc);
      });
    });
  }

  destroyAll(model, where, callback) {
    debug('CouchDB destroyAll');
    return this.all(model, {where}, (err, docs) => {
      if (err) {
        return callback && callback(err);
      }
      debug(docs);
      docs = (() => {
        var result = [];
        for (var i = 0, doc; i < docs.length; i++) {
          doc = docs[i];
          result.push({_id: doc.id, _rev: doc._rev, _deleted: true});
        }
        return result;
      })();
      return this._nanoWriter.bulk({docs}, function(err, rsp) {
        return callback && callback(err, rsp);
      });
    });
  }

  count(model, callback, where) {
    debug('CouchDB count');
    return this.all(model, {where}, (err, docs) => {
      if (err) {
        return callback && callback(err);
      }
      return callback && callback(null, docs.length);
    });
  }

  all(model, filter, callback) {
    var id;
    var ref;
    var where;
    debug('CouchDB all');
    debug(filter);
    // Consider first the easy case that a specific id is requested
    if (id = (((ref = ((typeof filter !== 'undefined' && filter !== null) ? filter.where : undefined)) != null) ? ref.id : undefined)) {
      debug('...moving to findById from all');
      // support include filter
      if ((typeof filter !== 'undefined' && filter !== null) ? filter.include : undefined) {
        return this.findById(model, id, (err, result) => {
          if (err) {
            return callback(err);
          }
          return this._models[model].model.include(result, filter.include, callback);
        });
      } else {
        return this.findById(model, id, callback);
      }
    }

    var params = {
      keys: [model],
      include_docs: true
    };

    if (filter.offset && !filter.where) {
      params.skip = filter.offset;
    }
    //if you have a where clause and a limit first get all the data and then limit them
    if (filter.limit && !filter.where) {
      params.limit = filter.limit;
    }

    // We always fallback on loopback/by_model view as it allows us
    // to iterate over all the docs for a model. But check if
    // there is a specialized view for one of the where conditions.
    var designName = 'loopback';
    var viewName = 'by_model';
    if (where = ((typeof filter !== 'undefined' && filter !== null) ? filter.where : undefined)) {
      var props = this._models[model].properties;
      for (var propName in where) {
        // We can use an optimal view when a where "clause" uses an indexed property
        var value = where[propName];
        if (value && (props[propName] != null) && props[propName].index) {
          // Use the design and view for the model and propName
          designName = helpers.designName(model);
          viewName = helpers.viewName(propName);
          // support loopback passing inq key arrays
          if ((value.inq != null)) {
            params.keys = [];
            for (var i = 0, key; i < value.inq.length; i++) {
              key = value.inq[i];
              params.keys.push(_.isDate(key) ? key.getTime() : key);
            }
          } else {
            // CouchDb stores dates as Unix time
            params.key = _.isDate(value) ? value.getTime() : value;
            // We don't want to use keys - we now have a key property
            delete params.keys;
          }
          break;
        }
      }
    }

    return this._nanoReader.view(designName, viewName, params, (err, body) => {
      var orders;
      if (err) {
        return callback && callback(err);
      }
      var docs = (() => {
        var result = [];
        for (var j = 0, row; j < body.rows.length; j++) {
          row = body.rows[j];
          row.doc.id = row.doc._id;
          delete row.doc._id;
          result.push(row.doc);
        }
        return result;
      })();


      debug('CouchDB all: docs before where');
      debug(docs);

      if (where = ((typeof filter !== 'undefined' && filter !== null) ? filter.where : undefined)) {
        docs = _.filter(docs, (doc) => {
          var isMatch = true;
          for (var k in where) {
            // CouchDb stores dates as Unix time
            var v = where[k];
            if (_.isDate(v)) {
              where[k] = v.getTime();
            }
            // support loopback inq queries
            if (where[k].inq) {
              if (!_.contains(where[k].inq, doc[k])) {
                isMatch = false;
              }
            } else {
              if (doc[k] !== where[k]) {
                isMatch = false;
              }
            }
          }
          return isMatch;
        });
      }

      debug('CouchDB all: docs after where');
      debug(docs);

      if (orders = ((typeof filter !== 'undefined' && filter !== null) ? filter.order : undefined)) {
        if (_.isString(orders)) { orders = [orders]; }
        var sorting = function(a, b) {
          var iterable = this;
          for (var i = 0, item; i < iterable.length; i++) {
            item = iterable[i];
            var ak;
            var bk;
            var rev;
            ak = a[this[i].key], bk = b[this[i].key], rev = this[i].reverse;
            if (ak > bk) {
              return 1 * rev;
            }
            if (ak < bk) {
              return -1 * rev;
            }
          }
          return 0;
        };

        for (var i = 0, key; i < orders.length; i++) {
          key = orders[i];
          orders[i] = {
            reverse: helpers.reverse(key),
            key: helpers.stripOrder(key)
          };
        }

        docs.sort(sorting.bind(orders));
      }

      var maxDocsNum;
      var startDocsNum;

      if (((typeof filter !== 'undefined' && filter !== null) ? filter.limit : undefined) && ((typeof filter !== 'undefined' && filter !== null) ? filter.where : undefined)) {
        maxDocsNum = filter.limit;
      } else {
        maxDocsNum = docs.length;
      }
      if (((typeof filter !== 'undefined' && filter !== null) ? filter.offset : undefined) && ((typeof filter !== 'undefined' && filter !== null) ? filter.where : undefined)) {
        startDocsNum = filter.offset;
      } else {
        startDocsNum = 0;
      }

      docs = docs.slice(startDocsNum, maxDocsNum);
      var output = ((() => {
        var result = [];
        for (var j = 0, doc; j < docs.length; j++) {
          doc = docs[j];
          result.push(this.fromDB(model, doc));
        }
        return result;
      })());

      // support include filter
      if ((typeof filter !== 'undefined' && filter !== null) ? filter.include : undefined) {
        return this._models[model].model.include(output, filter.include, callback);
      } else {
        return callback(null, output);
      }
    });
  }


  forDB(model, data = {}) {
    helpers.savePrep(model, data);
    var props = this._models[model].properties;
    for (var k in props) {
      var v = props[k];
      if (data[k] && props[k].type.name === 'Date' && (data[k].getTime != null)) {
        data[k] = data[k].getTime();
      }
    }
    return data;
  }

  fromDB(model, data) {
    if (!data) {
      return data;
    }
    helpers.undoPrep(data);
    var props = this._models[model].properties;
    for (var k in props) {
      var v = props[k];
      if ((data[k] != null) && props[k].type.name === 'Date') {
        var date = new Date(data[k]);
        date.setTime(data[k]);
        data[k] = date;
      }
    }
    return data;
  }

  exists(model, id, callback) {
    debug('CouchdDB exists');
    return this._nanoReader.head(id, function(err, _, headers) {
      if (err) {
        return callback && callback(null, 0);
      }
      return callback && callback(null, 1);
    });
  }

  getLatestRevision(model, id, callback) {
    return this._nanoReader.head(id, function(err, _, headers) {
      if (err) {
        return callback && callback(err);
      }
      var rev = headers.etag.substr(1, headers.etag.length - 2);
      return callback && callback(null, rev);
    });
  }

  destroy(model, id, callback) {
    debug('CouchDB destroy');
    return this.getLatestRevision(model, id, (err, rev) => {
      if (err) {
        return callback && callback(err);
      }
      return this._nanoWriter.destroy(id, rev, (err, rsp) => {
        return callback && callback(err, rsp);
      });
    });
  }

  findById(model, id, callback) {
    debug('CouchDB findById');
    return this._nanoReader.get(id, (err, doc) => {
      debug(err, doc);
      if (err && err.statusCode === 404) {
        return callback && callback(null, []);
      }
      if (err) {
        return callback && callback(err);
      }
      return callback && callback(null, [(this.fromDB(model, doc))]);  // Uses array as this function is called by all who needs to return array
    });
  }

  viewFunction(model, ddoc, viewname, keys, callback) {
    ddoc = ddoc ? ddoc : this.settings.database || this.settings.db;
    var view = _.findWhere(this._availableViews, {ddoc: ddoc, name: viewname});

    if (!view) {
      return callback && callback('The requested view is not available in the datasource');
    }
    var params = keys;
    if (typeof keys === 'function') {
      callback = keys;
      params = {};
    }
    if (typeof keys === 'string') {
      params = {keys: [keys]};
    }
    if (_.isArray(keys)) {
      params = {keys: keys};
    }


    debug(model, ddoc, viewname, params);

    return this._nanoReader.view(ddoc, viewname, params, (err, rsp) => {
      if (err) {
        return callback && callback(err);
      }
      var docs = _.pluck(rsp.rows, 'value');
      return callback && callback(null, ((() => {
        var result = [];
        for (var i = 0, doc; i < docs.length; i++) {
          doc = docs[i];
          result.push(this.fromDB(model, doc));
        }
        return result;
      })()));
    });
  }

  buildViewEndpoint(views) {
    this._availableViews = views;
    var fn = _.bind(this.viewFunction, this);
    fn.accepts = [
      {
        arg: 'modelName',
        type: 'string',
        description: 'The current model name',
        required: false,
        http(ctx) {
          return ctx.method.sharedClass.name;
        }
      },
      {
        arg: 'ddoc',
        type: 'string',
        description: 'The design document name for the requested view. Defaults to CouchDB database name used for this data.',
        required: false,
        http: {
          source: 'query'
        }
      },
      {
        arg: 'viewname',
        type: 'string',
        description: 'The view name requested.',
        required: true,
        http: {
          source: 'query'
        }
      },
      {
        arg: 'keys',
        type: 'object',
        description: 'The index(es) requested to narrow view results. Parameter can be a string, array of strings or object with \'key\' or with \'startkey\' and \'endkey\', as per CouchDB. Use the object version for complex keys querying.',
        required: false,
        http: {
          source: 'query'
        }
      }
    ];
    fn.returns = {
      arg: 'items',
      type: 'array'
    };
    fn.shared = true;
    fn.http = {
      path: '/queryView',
      verb: 'get'
    };
    fn.description = 'Query a CouchDB view based on design document name, view name and keys.';
    return fn;
  }

  buildAuthUrl(auth) {
    var authString;
    if (auth && (auth.username || auth.user) && (auth.password || auth.pass)) {
      authString = (auth.username || auth.user) + ':' + (auth.password || auth.pass) + '@';
    } else {
      authString = '';
    }
    var url = this.settings.protocol + '://' + authString + this.settings.hostname + ':' + this.settings.port + '/' + this.settings.database;
    return url;
  }
}

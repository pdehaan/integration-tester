
/**
 * Module dependencies.
 */

var Facade = require('segmentio-facade');
var inspect = require('util').inspect;
var fmt = require('util').format;
var join = require('path').join;
var assert = require('assert');
var utils = require('./utils');
var parse = require('ms');
var select = utils.select;
var qs = require('qs');
var type = utils.type;

/**
 * Message channels.
 */

var channels = [
  'server',
  'client',
  'mobile'
];

/**
 * Message types.
 */

var types = [
  'identify',
  'screen',
  'group',
  'alias',
  'track',
  'page'
];

/**
 * Expose `Assertion`
 */

module.exports = Assertion;

/**
 * Initialize a new `Assertion`.
 *
 * @param {Integration} integration
 * @param {String} dirname
 * @api public
 */

function Assertion(integration, dirname){
  if (!(this instanceof Assertion)) return new Assertion(integration, dirname);
  assert(integration, 'expected integration');
  this.createRequest = integration.request;
  integration.request = this.request.bind(this);
  this.integration = integration;
  this.dirname = dirname;
  this.assertions = [];
  this.settings = {};
  this.reqs = [];
  this.q = {};
}

/**
 * Assert that `fixture` is equal.
 *
 * @param {String} fixture
 * @param {Object} settings
 * @api public
 */

Assertion.prototype.fixture = function(fixture, settings){
  assert(this.dirname, 'you must pass dirname to Assertion()');

  // args
  var settings = settings || this.settings;
  var dir = join(this.dirname, 'fixtures', fixture + '.json');
  var json = require(dir);
  var actual = json.input;
  var type = actual.type;
  var expected = json.output;

  // to message
  assert(actual.type, 'input.type must be specified');
  var msg = toMessage(actual);
  var map = this.integration.mapper[type];

  // make sure map() exists.
  assert(map, 'integration.mapper.' + type + '() is missing');

  // merge settings if available.
  if (json.settings) {
    for (var k in json.settings) {
      settings[k] = json.settings[k];
    }
  }

  // map
  actual = map.call(this.integration, msg, settings);

  // make sure map returned something
  assert(actual, 'integration.mapper.' + type + '() returned "' + utils.type(actual) + '"');

  // transform dates
  actual = JSON.parse(JSON.stringify(actual));

  // compare
  try {
    assert.deepEqual(actual, expected);
  } catch (e) {
    e.showDiff = true;
    throw e;
  }
};

/**
 * Assert integration has requires `method` with `path`.
 *
 * @param {String} method
 * @param {String} path
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.requires = function(method, path){
  var reqs = this.integration.constructor.requirements || [];
  if (!path) path = method, method = null;

  var has = reqs.some(function(req){
    return req.method == method && path == req.path;
  });

  if (has) return this;

  if (method) throw errorf('expected integration to require "%s" on "%s"', path, method);
  throw errorf('expected integration to require "%s"', path);
};

/**
 * Assert integration has option `name` with `meta`.
 *
 * @param {String} name
 * @param {Object} meta
 * @api public
 */

Assertion.prototype.option = function(name, meta){
  var opts = this.integration.constructor.options;
  if (!opts[name]) throw errorf('expected integration to have option "%s"', name);
  var actual = opts[name];
  delete actual.validate;
  var err = utils.equals(actual, meta);
  if (err) throw err;
  return this;
};

/**
 * Assert the integration is enabled on `channels`.
 *
 * @param {Array} chans
 * @api public
 */

Assertion.prototype.channels = function(expected){
  var actual = this.integration.channels;
  var err = utils.equals(actual, expected);
  if (err) throw err;
  return this;
};

/**
 * Assert the integration is valid with `msg`, `settings`.
 *
 * @param {Facade|Object} msg
 * @param {Object} settings
 * @api public
 */

Assertion.prototype.valid = function(msg, settings){
  var msg = toMessage(msg);
  var settings = settings || this.settings;
  var err = this.integration.validate(msg, settings);
  if (err) throw err;
};

/**
 * Assert the integration is invalid with `msg`, `settings`.
 *
 * @param {Facade|Object} msg
 * @param {Object} settings
 * @api public
 */

Assertion.prototype.invalid = function(msg, settings){
  var msg = toMessage(msg);
  var settings = settings || this.settings;
  var err = this.integration.validate(msg, settings);
  if (!err) throw new Error('expected .validate(msg, settings) to return an error.');
};

/**
 * Assert requests `n`.
 *
 * @param {Number} n
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.requests = function(n){
  var reqs = this.reqs;

  this.assertions.push(function(){
    if (n == reqs.length) return;
    return errorf('expected number of requests to be "%d", but it\'s "%d"', n, reqs.length);
  });

  return this;
};

/**
 * Assert retries `n`.
 *
 * @param {Number} n
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.retries = function(n){
  var retries = this.integration.retries;
  if (n == retries) return this;
  throw errorf('expected retries to be "%s" but it\'s "%s"', n, retries);
};

/**
 * Assert name `name`.
 *
 * @param {String} name
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.name = function(name){
  var actual = this.integration.name;
  if (name == actual) return this;
  throw errorf('expected name to be "%s" but it\'s "%s"', name, actual);
};

/**
 * Assert timeout `ms`.
 *
 * @param {String|Number} ms
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.timeout = function(ms){
  var timeout = this.integration.timeout;
  if ('string' == typeof ms) ms = parse(ms);
  if (ms == timeout) return this;
  throw errorf('expected timeout to be "%s" but it\'s "%s"', ms, timeout);
};

/**
 * Assert the endpoint to be `url`
 *
 * @param {String} url
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.endpoint = function(url){
  var endpoint = this.integration.endpoint;
  if (url == endpoint) return this;
  throw errorf('expected endpoint to be "%s" but it\'s "%s"', url, endpoint);
};

/**
 * Set settings `key, `value`.
 *
 * @param {String|Object} key
 * @param {Mixed} value
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.set = function(key, value){
  if ('object' == typeof key) {
    for (var k in key) this.set(k, key[k]);
    return this;
  }

  this.settings = this.settings || {};
  this.settings[key] = value;
  return this;
};

/**
 * Assert the request `path`.
 *
 * Example:
 *
 *      assertion(integration)
 *        .track({ event: 'my event' })
 *        .pathname('/track')
 *        .expects(200, done);
 *
 * @param {Object} obj
 * @return {Assertion}
 * @api private
 */

Assertion.prototype.pathname = function(value){
  var self = this;

  this.assertions.push(function(req){
    var pathname = req.req.path.split('?')[0];
    if (pathname == value) return;
    return errorf('expected request pathname '
      + 'to be "%s" '
      + 'but got "%s"'
      , value.toString()
      , pathname);
  });

  return this;
};

/**
 * Add query.
 *
 * Example:
 *
 *      assertion(integration)
 *        .track({ event: 'my event' })
 *        .query({ one: 1 })
 *        .query({ two: 2 })
 *        .expects(200, done);
 *
 * @param {Object} obj
 * @return {Assertion}
 * @api private
 */

Assertion.prototype.query = function(obj){
  var self = this;

  for (var k in obj) this.q[k] = obj[k];

  if (!this.pushedQueryAssertion) {
    this.pushedQueryAssertion = true;
    this.assertions.push(function(req){
      var query = req.req.path.split('?')[1];
      if (!query) return new Error('expected request to include query string but no query string was found');
      var expected = self.q;
      var actual = qs.parse(query);
      return utils.equals(actual, expected);
    });
  }

  return this;
};

/**
 * Integration sends `...`.
 *
 * @param {...}
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.sends = function(){
  var args = [].slice.call(arguments);
  var value = args[0];

  this.assertions.push(function(req){
    if (2 == args.length) return utils.header(req, args);
    if ('object' == type(value)) return utils.equals(req._data, value);
    if ('regexp' == type(value)) return utils.match(req._data, value);
    if ('?' == value[0]) return utils.query(req, value);
    if ('string' == type(value)) return utils.equals(req._data, value);
    return errorf('unknown assertion "%s"', inspect(args));
  });

  return this;
};

/**
 * Integration expects `...`
 *
 * @param {...}
 * @return {Assertion}
 * @api public
 */

Assertion.prototype.expects = function(){
  var args = [].slice.call(arguments);
  var value = args[0];
  var self = this;
  var fn;

  if ('function' == typeof args[1]) {
    fn = args.pop();
    process.nextTick(function(){
      self.end(fn);
    });
  }

  this.assertions.push(function(_, res){
    if (2 == arguments.length) return utils.header(res, args);
    if ('object' == type(value)) return utils.equals(res.body, value);
    if ('regexp' == type(value)) return utils.match(res.text, value);
    if ('string' == type(value)) return utils.equals(res.text, value);
    if ('number' == type(value)) return utils.equals(res.status, value);
    return errorf('unknown assertion "%s"', inspect(args));
  });

  return this;
};

/**
 * Assert that the integration errors.
 *
 * @param {Function} fn
 * @api public
 */

Assertion.prototype.error = function(fn){
  this.end(function(err){
    if (err) return fn();
    fn(new Error('expected integration to error'));
  });
};

/**
 * End.
 *
 * @param {Function} fn
 * @api public
 */

Assertion.prototype.end = function(fn){
  assert(this.msg, 'you must call .identify() / .alias() etc..');
  var integration = this.integration;
  var msg = this.msg;
  var type = msg.type();
  var self = this;

  integration[type](msg, this.settings, function(err, res){
    if (err) return fn(err);
    self.assert(self.req, res, fn);
  });

  return this;
};

/**
 * Create request with `path`.
 *
 * @param {...} args
 * @return {Request}
 * @api private
 */

Assertion.prototype.request = function(){
  this.req = this.createRequest.apply(this.integration, arguments);
  this.reqs.push(this.req);
  return this.req;
};

/**
 * Assert that the integration is enabled for `msg`.
 *
 * @param {Facade|Object} msg
 * @param {Object} settings [optional]
 * @return {Boolean}
 * @api public
 */

Assertion.prototype.enabled = function(msg, settings){
  var settings = settings || this.settings;
  var msg = toMessage(msg);
  if (this.integration.enabled(msg, settings)) return this;
  throw errorf('expected integration to be enabled with "%s", "%s"'
    , inspect(msg.json())
    , inspect(settings));
};

/**
 * Assert that the integration is disabled for `msg`.
 *
 * @param {Facade|Object} msg
 * @param {Object} settings
 * @api public
 */

Assertion.prototype.disabled = function(msg, settings){
  var settings = settings || this.settings;
  var msg = toMessage(msg);
  if (!this.integration.enabled(msg, settings)) return this;
  throw errorf('expected integration to be disabled with "%s", "%s"'
    , inspect(msg.json())
    , inspect(settings));
};

/**
 * Assert that all channels are enabled.
 *
 * @param {Object} msg
 * @param {Object} settings
 * @return {Boolean}
 * @api public
 */

Assertion.prototype.all = function(msg, settings){
  var settings = settings || this.settings;
  var msg = toMessage(msg || {});
  var self = this;

  var disabled = channels.filter(function(channel){
    msg.obj.channel = channel;
    return !self.integration.enabled(msg, settings);
  });

  if (disabled.length) {
    throw errorf('expected message to be '
      + 'enabled on all channels, '
      + 'but it is disabled on "%s"'
      , disabled.join(', '));
  }

  return this;
};

/**
 * Assert with `req`, `res` and `fn(err, res)`.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {Function} fn
 * @api private
 */

Assertion.prototype.assert = function(req, res, fn){
  var err = select(this.assertions, function(assert){
    return assert(req, res, fn);
  });

  fn(err, res);
};

/**
 * Add message types.
 */

types.forEach(function(type){
  var Message = Facade[type[0].toUpperCase() + type.slice(1)];
  Assertion.prototype[type] = function(msg, settings){
    if ('function' != typeof msg.type) msg = new Message(msg);
    if (2 == arguments.length) this.set(settings);
    this.msg = msg;
    return this;
  };
});

/**
 * Add message channels.
 */

channels.forEach(function(channel){
  Assertion.prototype[channel] = function(msg){
    msg = toMessage(msg);
    msg.obj.channel = channel;
    if (this.integration.enabled(msg)) return this;
    throw errorf('expected integration to be enabled on "%s"', channel);
  };
});

/**
 * Create `Facade` message from `obj`.
 *
 * @param {Facade|Object} msg
 * @return {Facade}
 * @api private
 */

function toMessage(msg){
  var msg = msg || {};
  if ('function' == typeof msg.type) return msg;
  var type = msg.action || msg.type || 'track';
  type = type[0].toUpperCase() + type.slice(1);
  return new Facade[type](msg);
}

/**
 * Errorf `...`
 *
 * @param {String} ...
 * @return {Error}
 * @api private
 */

function errorf(){
  return new Error(fmt.apply(null, arguments));
}

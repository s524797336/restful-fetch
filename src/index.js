import fetch from 'isomorphic-fetch';
import {merge, toQueryString, processHandlers} from './utils';

const ARGS_WO_PAYLOAD = ['url', 'params'];
const ARGS_W_PAYLOAD = ['url', 'body', 'params'];

const methods = {
  get: {
    method: 'GET',
    args: ARGS_WO_PAYLOAD,
  },
  post: {
    method: 'POST',
    args: ARGS_W_PAYLOAD,
  },
  put: {
    method: 'PUT',
    args: ARGS_W_PAYLOAD,
  },
  patch: {
    method: 'PATCH',
    args: ARGS_W_PAYLOAD,
  },
  delete: {
    method: 'DELETE',
    args: ARGS_WO_PAYLOAD,
  },
};
methods.remove = methods.delete;

const decode = (ui8) => {
  if (TextDecoder) {
    return new TextDecoder('utf-8').decode(ui8);
  }
  return String.fromCharCode(...ui8);
}

export default function Restful(options) {
  if (!(this instanceof Restful)) return new Restful(options);
  options = this.options = Object.assign({}, options);
  options.root = (options.root || '').replace(/\/$/, '');
  options.config = Object.assign({}, options.config);
  options.headers = Object.assign({}, options.headers);
  options.methods = Object.assign({}, methods, options.methods);
  this.prehandlers = [
    // check content-type
    request => {
      const {body} = request;
      if (Object.prototype.toString.call(body) === '[object FormData]') {
        return;
      }
      if (body && typeof body === 'object') {
        return {
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        };
      }
    },
  ];
  this.posthandlers = [
    // parse payload
    (res, request) => Promise.resolve()
      .then(() => {
        if (res.status === 204) return {};
        const contentType = res.headers.get('content-type');
        if (/application\/json/.test(contentType)) {
          return res.json();
        } else if (/text\//.test(contentType)) {
          return res.text();
        } else if (/application\/octet-stream/.test(contentType) && res.headers.get('content-length')) {
          const total = parseInt(res.headers.get('content-length'));
          let charsReceived = 0;
          let result = '';
          if (res.body.getReader) {
            const reader = res.body.getReader();
            return new Promise((resolve, reject) => {
              reader.read().then(function processText({ done, value }) {
                // Result objects contain two properties:
                // done  - true if the stream has already given you all its data.
                // value - some data. Always undefined when done is true.

                // value for fetch streams is a Uint8Array

                if (done) {
                  resolve(result);
                  return;
                }

                charsReceived += value.length;
                request.onProgress && request.onProgress(charsReceived, total);

                result += decode(value);

                // Read some more, and call this function again
                return reader.read().then(processText);
              }).catch(reject);
            });
          }

          return new Promise((resolve, reject) => {
            res.body.on('data', (value) => {
              charsReceived += value.length;
              request.onProgress && request.onProgress(charsReceived, total);
              result += value;
            });
            res.body.on('end', () => {
              resolve(result);
            });
            res.body.on('error', (err) => {
              reject(err);
            });
          });
        } else {
          return res.blob();
        }
      })
      .then(data => ({res, data})),
    // return data
    ({res, data}) => {
      // res.ok is not supported in QQBrowser
      if (res.status >= 200 && res.status < 300) return data;
      // if (res.ok) return data;
      throw {status: res.status, data};
    },
  ];
  this.errhandlers = [
    i => {throw i;},
  ];
  const root = this.root = new Model(this);
  [
    'model',
  ]
    .concat(Object.keys(options.methods))
    .forEach(method => {
      this[method] = root[method].bind(root);
    });
}

Object.assign(Restful.prototype, {
  _prepareRequest(options, overrides) {
    const {method, url, params, body, signal, headers, onProgress} = options;
    const request = {
      url,
      method,
      params,
      body,
      signal,
      headers: Object.assign({}, this.options.headers, headers),
      onProgress,
    };
    return processHandlers(
      overrides && overrides.prehandlers || this.prehandlers, request,
      (request, handler) => merge(request, handler(request), ['headers'])
    );
  },

  _fetch(request) {
    const init = ['method', 'headers', 'body', 'signal', 'onProgress']
      .reduce((init, key) => {
        const val = request[key];
        if (val != null) init[key] = val;
        return init;
      }, Object.assign({}, this.options.config));
    const url = request.url + toQueryString(request.params);
    return fetch(url, init);
  },

  _request(options, overrides) {
    return this._prepareRequest(options, overrides)
      .then(request => (
        this._fetch(request)
          .then(res => processHandlers(overrides && overrides.posthandlers || this.posthandlers, res, request))
      ))
      .catch(res => processHandlers(overrides && overrides.errhandlers || this.errhandlers, res));
  },
});

const RE_SLASHES = /^\/|\/$/g;
const RE_ABSURL = /^[\w-]+:/;
const RE_PLACEHOLDER = /\/:([^/]*)/g;

function Model(restful, path) {
  if (!(this instanceof Model)) return new Model(restful, path);
  this.restful = restful;
  this.prehandlers = [];
  this.posthandlers = [];
  this.overrides = null;
  this.parameters = null;
  this._setPath(path);
  this._bindMethods();
}

Object.assign(Model.prototype, {
  _setPath(path) {
    if (path) {
      path = path.replace(RE_SLASHES, '')
        .split('/')
        .filter(c => c)
        .map(comp => {
          if (!comp) {
            throw new Error('Invalid path!');
          }
          if (comp[0] === ':') {
            this._addParam(comp.slice(1));
          }
          return comp;
        })
        .join('/');
      if (path) path = '/' + path;
    }
    this.path = path || '';
  },

  _addParam(name) {
    const parameters = this.parameters = this.parameters || {};
    if (parameters[name]) {
      throw new Error(`Invalid path: parameter "${name}" already exists!`);
    }
    parameters[name] = true;
  },

  _bindMethods() {
    const bindMethod = (key, item) => {
      this[key] = (...args) => {
        const options = item.args.reduce((res, arg, i) => {
          const value = args[i];
          if (value != null) res[arg] = value;
          return res;
        }, {method: item.method});
        return this.request(options);
      };
    };
    const {methods} = this.restful.options;
    methods && Object.keys(methods).forEach(key => bindMethod(key, methods[key]));
  },

  model(...parts) {
    let path = parts.filter(part => part).join('/');
    if (path) path = '/' + path;
    return new Model(this.restful, this.path + path);
  },

  fill(data) {
    const path = this.path.replace(RE_PLACEHOLDER, (match, key) => {
      const value = data[key];
      return value == null ? match : '/' + encodeURIComponent(value);
    });
    const model = new Model(this.restful, path);
    model.prehandlers = this.prehandlers;
    model.posthandlers = this.posthandlers;
    return model;
  },

  request(options) {
    if (this.parameters) {
      throw new Error('Abstract model cannot be requested!');
    }
    return processHandlers(
      this.prehandlers, options,
      (options, handler) => Object.assign({}, options, handler(options))
    ).then(options => {
      var url = options.url || '';
      if (!RE_ABSURL.test(url)) {
        if (url && url[0] !== '/') url = '/' + url;
        options.relative = url;
        url = this.restful.options.root + this.path + url;
      } else {
        options.relative = null;
      }
      options.url = url;
      return this.restful._request(options, this.overrides)
        .then(res => processHandlers(this.posthandlers, res, options));
    });
  },
});

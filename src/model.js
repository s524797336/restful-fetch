export default class Model {
  constructor(restful, path) {
    this.restful = restful;
    this.path = path || '';
    this.prehandlers = [];
    this.posthandlers = [];
  }

  request(options) {
    options = this.prehandlers.reduce((options, handler) => {
      return Object.assign({}, options, handler(options));
    }, options);
    const url = options.url || '';
    if (!url || url[0] === '/') options.url = this.path + url;
    return this.restful._request(options)
    .then(res => this.posthandlers.reduce((res, handler) => handler(res), res));
  }

  get(url, params) {
    return this.request({
      method: 'GET',
      url, params,
    });
  }

  post(url, body, params) {
    return this.request({
      method: 'POST',
      url, params, body,
    });
  }

  put(url, body, params) {
    return this.request({
      method: 'PUT',
      url, params, body,
    });
  }

  remove(url, params) {
    return this.request({
      method: 'DELETE',
      url, params,
    });
  }

  model(path) {
    path = (path || '').replace(/\/$/, '');
    if (!path) {
      throw new Error('Invalid path: path cannot be empty!');
    }
    if (path[0] !== '/') path = '/' + path;
    return new Model(this.restful, this.path + path);
  }
}
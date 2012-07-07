var http   = require("http")
  , https  = require("https")
  , crypto = require("crypto")

function Database(host, credentials) {
  this.host    = host
  this.account = new Account(credentials)
}

Database.prototype = {
  request: function request(target, data, cb) {
    var req = new Request(this.host, target, data || {})

    this.account.sign(req, function(err) {
      if (err) cb(err)

      else req.send(cb)
    })

    return this
  }
}

function Request(host, target, data) {
  var headers = this.headers = new RequestHeaders

  this.json = JSON.stringify(data)

  headers["x-amz-target"] = Request.prototype.target + target
  headers["Host"] = this.host = host
  headers["Content-Length"] = Buffer.byteLength(this.json)
}

Request.prototype = {
  method:   "POST",
  pathname: "/",
  target:   "DynamoDB_20111205.",
  data:     {},

  toString: function() {
    return this.method +
      "\n" + this.pathname +
      "\n" +
      "\n" + this.headers +
      "\n" +
      "\n" + this.json
  },

  send: function(cb) {
    var request = http.request(this, function(res) {
      var json = ""

      res.on("data", function(chunk){ json += chunk })
      res.on("end", function() {
        var error, response = JSON.parse(json)

        if (res.statusCode == 200) return cb(null, response)

        error = new Error
        error.name = response.__type
        error.message = response.message
        error.statusCode = res.statusCode

        cb(error)
      })
    })

    request.on("error", cb)

    request.write(this.json)
    request.end()
  }
}

function RequestHeaders() {
  this["x-amz-date"]   = this["Date"] = (new Date).toUTCString()
  this["Content-Type"] = RequestHeaders.prototype["Content-Type"]
}

RequestHeaders.prototype = {
  "Content-Type": "application/x-amz-json-1.0",

  toString: function() {
    return "host:"                 + this["Host"] +
         "\nx-amz-date:"           + this["x-amz-date"] +
         "\nx-amz-security-token:" + this["x-amz-security-token"] +
         "\nx-amz-target:"         + this["x-amz-target"]
  }
}

function Account(credentials) {
  this.session = new Session(credentials)
}

Account.prototype = {
  sign: function(request, cb) {
    this.session.fetch(function(err, session) {
      if (err) return cb(err)

      var hash = crypto.createHash("sha256")
        , payload

      request.headers["x-amz-security-token"] = session.token

      payload = new Buffer(request.toString(), "utf8")
      hash = hash.update(payload).digest()

      request.headers["x-amzn-authorization"] = "AWS3 " + [
        "AWSAccessKeyId=" + session.tokenCredentials.accessKeyId,
        "Algorithm=HmacSHA256",
        "SignedHeaders=host;x-amz-date;x-amz-security-token;x-amz-target",
        "Signature=" + session.tokenCredentials.sign(hash)
      ]

      cb(null, request)
    })
  }
}

function Session(attrs) {
  this.sessionCredentials = new Credentials(attrs || {})
  this.tokenCredentials = null
  this.listeners = []
}

Session.prototype = {
  duration: 60 * 60 * 1000,
  refreshPadding: 60 * 1000, //refresh 1 minute ahead of time
  consumedCapacity: 0,

  fetch: function(cb) {
    if ((this.expiration - this.refreshPadding) > new Date) return cb(null, this)

    this.listeners.push(cb) > 1 || this.refresh()
  },

  refresh: function() {
    var req = new SessionRequest

    req.query.DurationSeconds = 0 | this.duration / 1000
    req.query.AWSAccessKeyId = this.sessionCredentials.accessKeyId
    req.query.Signature = this.sessionCredentials.sign(req.toString(), "sha256", "base64")

    req.send(function(err, data) {
      var listeners = this.listeners.splice(0)

      if (!err) {
        this.expiration = new Date(data.expiration)
        this.tokenCredentials = new Credentials(data)
        this.token = data.sessionToken
      }

      listeners.forEach(function(cb) {
        cb(err, err ? null : this)
      }, this)
    }.bind(this))
  }
}

function SessionRequest() {
  this.query = new SessionQuery
}

SessionRequest.prototype = {
  method:   "GET",
  host:     "sts.amazonaws.com",
  pathname: "/",

  toString: function() {
    return   this.method +
      "\n" + this.host   +
      "\n" + this.pathname +
      "\n" + this.query.toString().slice(1)
  },

  send: function(cb) {
    var signature = encodeURIComponent(this.query.Signature)
      , query = this.query + "&Signature=" + signature
      , path = Request.prototype.pathname + query
      , options = { host: this.host, path: path }

    https.get(options, function(res) {
      var xml = ""

      res.on("data", function(chunk){ xml += chunk })
      res.on("end", function() {
        var response = new SessionResponse(xml)

        if (res.statusCode == 200) cb(null, response)

        else cb(new Error(
          response.type + "(" + response.code + ")\n\n" +
          response.message
        ))
      })
    })
  }
}

function SessionQuery() {
  this.Timestamp = (new Date).toISOString().slice(0, 19) + "Z"
}

SessionQuery.prototype = {
  Action           : "GetSessionToken",
  SignatureMethod  : "HmacSHA256",
  SignatureVersion : "2",
  Version          : "2011-06-15",

  toString: function() {
    return (
      "?AWSAccessKeyId="   + this.AWSAccessKeyId +
      "&Action="           + this.Action +
      "&DurationSeconds="  + this.DurationSeconds +
      "&SignatureMethod="  + this.SignatureMethod +
      "&SignatureVersion=" + this.SignatureVersion +
      "&Timestamp="        + encodeURIComponent(this.Timestamp) +
      "&Version="          + this.Version
    )
  }
}

function SessionResponse(xml) {
  var tag, key, regexp = /<(\w+)>(.*)</g

  while (tag = regexp.exec(xml)) {
    key = tag[1]
    key = key.charAt(0).toLowerCase() + key.slice(1)
    this[key] = tag[2]
  }
}

function Credentials(attrs) {
  var env = process.env
    , secretAccessKey = attrs.secretAccessKey || env.AWS_SECRET_ACCESS_KEY

  this.accessKeyId = attrs.accessKeyId || env.AWS_ACCESS_KEY_ID

  if (!secretAccessKey) {
    throw new Error("No secret access key available.")
  }

  if (!this.accessKeyId) {
    throw new Error("No access key id available.")
  }

  this.sign = function(data) {
    return crypto
      .createHmac("sha256", secretAccessKey)
      .update(data)
      .digest("base64")
  }
}

exports.Database        = Database
exports.Request         = Request
exports.RequestHeaders  = RequestHeaders
exports.Account         = Account
exports.Session         = Session
exports.SessionRequest  = SessionRequest
exports.SessionQuery    = SessionQuery
exports.SessionResponse = SessionResponse
exports.Credentials     = Credentials

exports.createClient = function(host, credentials) {
  return new Database(host, credentials)
}

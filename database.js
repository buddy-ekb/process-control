(function (module, console) {

    var PG = require('pg');

    var config = require('./configuration');
    var iosock = require('./iosock');

    function query(queryText, parameters) {
        return new Promise(function (resolve, reject) {
            PG.connect(config.database, function(err, client, done) {
                if (err) {
                    return reject(err);
                }
                client.query(queryText, parameters, function (err, result) {
                    done();
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        });
    }

    function select(tableName, predicate, parameters) {
        return query("SELECT * FROM " + tableName + " AS t" + (predicate || ""), parameters);
    }

    function update(tableName, tuples, predicate, parameters) {
        var toUpdate = [], params = [];
        var idx = 1;
        tuples.forEach(function (tuple) {
            toUpdate.push(tuple[0] + " = $" + (idx++));
            params.push(tuple[1]);
        });
        var queryText = "UPDATE " + tableName + " SET " + toUpdate.join(", ") + predicate + (idx++);
        return query(queryText, params.concat(parameters));
    }

    PG.connect(config.database, function(err, client) {
        if (err) {
            console.log(err);
        }
        client.on('notification', function (msg) {
            if (iosock.io) {
                iosock.io.sockets.emit('notify', msg.payload);
            }
        });
        client.query("LISTEN " + config.listen_to);
    });

    [1114, 1184].forEach(function (oid) { // timestamp, timestamptz
        PG.types.setTypeParser(oid, function (val) {
            return val;
        });
    });

    function Transaction(client, done) {
        this.client = client;
        this.done = done;
    }

    Transaction.prototype.query = function (queryText, parameters) {
        if (!this.client) {
            return Promise.reject('transaction is closed');
        }
        var self = this;
        return new Promise(function (resolve, reject) {
            self.client.query(queryText, parameters, function (err, result) {
                if (err) {
                    self.rollback();
                    return reject(err);
                }
                resolve(result);
            });
        });
    };

    Transaction.prototype.rollback = function () {
        if (!this.client) {
            return;
        }
        var self = this;
        this.client.query("ROLLBACK", this.done);
        delete this.client;
    };

    Transaction.prototype.commit = function () {
        if (!this.client) {
            return;
        }
        var self = this;
        return new Promise(function (resolve, reject) {
            self.client.query("COMMIT", function (err) {
                self.done();
                if (err) {
                    reject(err);
                }
                resolve();
            });
            delete self.client;
        });
    };

    function begin() {
        return new Promise(function (resolve, reject) {
            PG.connect(config.database, function(err, client, done) {
                if (err) {
                    return reject(err);
                }
                var transaction = new Transaction(client, done);
                transaction.query("BEGIN")
                    .then(function () {
                        resolve(transaction);
                    }, function (err) {
                        reject(err);
                    });
            });
        });
    }

    module.exports = {
        query: query,
        select: select,
        update: update,
        begin: begin
    };

})(module, console);

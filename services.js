(function (module) {

    var express = require('express');
    var router = express.Router();
    var db = require('./database');

    var idColumn = 'id';

    var pgDataTypes = {
        'BOOL': 16,
        'SMALLINT': 21,
        'INT': 23,
        'INTary': 1007,
        'INT8': 20,
        'NUMERIC': 1700,
        'TEXT': 25,
        'VARCHAR': 1043,
        'DATE': 1082,
        'TIMESTAMP': 1114,
        'TIMESTAMPTZ': 1184
    };

    var pgColTypes = {};
    pgColTypes[pgDataTypes.BOOL] = 'checkbox';
    pgColTypes[pgDataTypes.SMALLINT] = 'numeric';
    pgColTypes[pgDataTypes.INT] = 'numeric';
    pgColTypes[pgDataTypes.INTary] = 'text';
    pgColTypes[pgDataTypes.INT8] = 'numeric';
    pgColTypes[pgDataTypes.NUMERIC] = 'numeric';
    pgColTypes[pgDataTypes.VARCHAR] = 'text';
    pgColTypes[pgDataTypes.DATE] = 'text'; // 'date';
    pgColTypes[pgDataTypes.TIMESTAMP] = 'text'; // 'date';
    pgColTypes[pgDataTypes.TIMESTAMPTZ] = 'text'; // 'date';

    function isTextCol(col) {
        return col.dataTypeID == pgDataTypes.TEXT || col.dataTypeID == pgDataTypes.VARCHAR;
    }

    function getColType(col) {
        if (col.dataTypeID in pgColTypes)
            return pgColTypes[col.dataTypeID];
        return null;
    }

    function getVal(row, colName, colInfo) {
        var val = colName in row ? row[colName] : null;
        if (colInfo.dataTypeID == pgDataTypes.BOOL && val == null) {
            val = false;
        }
        if (colInfo.dataTypeID == pgDataTypes.NUMERIC && val != null) {
            val = +val;
        }
        if (val instanceof Date) {
            if (colInfo.dataTypeID == pgDataTypes.DATE) {
                val = val.getDMY();
            } else {
                val = val.toString();
            }
        }
        return val;
    }

    function requireViewParameter(req, res, next) {
        if (!('view' in req.query)) {
            res.status(400).send('missing view parameter');
        } else {
            next();
        }
    }

    router.get('/get', requireViewParameter, function (req, res) {
        var queryResult, enumTypes = {}, typeId = [];
        db.select(req.query.view)
            .then(function (result) {
                queryResult = result;
                var promises = [];
                result.fields
                    .filter(function (column) { return getColType(column) == null; })
                    .forEach(function (column) {
                        if (!(column.dataTypeID in enumTypes)) {
                            enumTypes[column.dataTypeID] = true;
                            promises.push(db.query("SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = $1", [ column.dataTypeID ]));
                            typeId.push(column.dataTypeID);
                        }
                    });
                return promises.length ? Promise.all(promises) : [];
            })
            .then(function (udtResults) {
                udtResults.forEach(function (udtResult, idx) {
                    if (udtResult.rows.length) {
                        enumTypes[typeId[idx]] = udtResult.rows.map(function (row) { return row.enumlabel; });
                    } else {
                        delete enumTypes[typeId[idx]];
                    }
                });
                var colRef = {}, colList = [], colTypes = [];
                queryResult.fields.forEach(function (column) {
                    colRef[column.name] = column;
                    colList.push(column.name);
                    var colType = {};
                    colTypes.push(colType);
                    if (column.name == idColumn) {
                        colType.readOnly = true;
                    }
                    var ct = getColType(column);
                    if (ct && ct != 'text') {
                        colType.type = ct;
                        if (column.dataTypeID == pgDataTypes.NUMERIC) {
                            colType.format = '0.00';
                        }
/*                        if (column.dataTypeID == pgDataTypes.DATE) {
                            colType.dateFormat = 'DD/MM/YYYY';
                            colType.correctFormat = true;
                        }*/
                    }
                    if (column.dataTypeID in enumTypes) {
                        colType.type = 'dropdown';
                        colType.source = [];
                        enumTypes[column.dataTypeID].forEach(function (enumLabel) { colType.source.push(enumLabel); });
                    }
                });
                var output = { colHeaders: colList, columns: colTypes, data: [] };
                queryResult.rows.forEach(function (row) {
                    var outputRow = [];
                    colList.forEach(function (colName) {
                        outputRow.push(getVal(row, colName, colRef[colName]));
                    });
                    output.data.push(outputRow);
                });
                res.set('Content-Type', 'application/json; charset=utf-8');
                res.send(JSON.stringify(output));
            })
            .catch(function (err) {
                res.status(500).send(err);
            });
    });

    router.post('/update', requireViewParameter, function (req, res) {
        if (!(req.body instanceof Array)) {
            return res.status(400).send('invalid request body');
        }
        var output = { success: [] };
        db.begin().then(function (transaction) {
            return req.body.reduce(function (cur, change) {
                return cur.then(function () {
                    return transaction.query("UPDATE " + req.query.view + " SET " + change.column + " = $1 WHERE " + idColumn + " = $2 RETURNING " + idColumn, [ change.value, change.id ])
                        .then(function (result) {
                            output.success.push(result.rows[0][idColumn]);
                            return true;
                        });
                    });
                }, Promise.resolve())
            .then(transaction.commit.bind(transaction))
            .catch(function (err) {
                transaction.rollback();
                output = { error: err.toString() };
                return false;
            });
        })
        .then(function () {
            res.set('Content-Type', 'application/json; charset=utf-8');
            res.send(JSON.stringify(output));
        })
        .catch(function (err) {
            res.status(500).send(err);
        });
    });

    module.exports = router;
})(module);

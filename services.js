(function (module) {

    var express = require('express');
    var builder = require('xmlbuilder');

    var router = express.Router();

    var db = require('./database');

    var idColumn = 'id';
    var defaultColWidth = 70;

    var dataTypes = {
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

    var colTypes = {};
    colTypes[dataTypes.BOOL] = 'ch';
    colTypes[dataTypes.SMALLINT] = 'edn';
    colTypes[dataTypes.INT] = 'edn';
    colTypes[dataTypes.INTary] = 'ed';
    colTypes[dataTypes.INT8] = 'edn';
    colTypes[dataTypes.NUMERIC] = 'ed';
    colTypes[dataTypes.TEXT] = 'txt';
    colTypes[dataTypes.VARCHAR] = 'txt';
    colTypes[dataTypes.DATE] = 'dhxCalendar';
    colTypes[dataTypes.TIMESTAMP] = 'ed';
    colTypes[dataTypes.TIMESTAMPTZ] = 'ed';

    var colSort = {};
    colSort[dataTypes.BOOL] = 'int';
    colSort[dataTypes.SMALLINT] = 'int';
    colSort[dataTypes.INT] = 'int';
    colSort[dataTypes.INT8] = 'int';
    colSort[dataTypes.DATE] = 'date';

    function isTextCol(col) {
        return col.dataTypeID == dataTypes.TEXT || col.dataTypeID == dataTypes.VARCHAR;
    }

    function getColType(col) {
        if (col.name == idColumn)
            return 'ro';
        if (col.dataTypeID in colTypes)
            return colTypes[col.dataTypeID];
        return null;
    }

    function getColSort(col) {
        return col.dataTypeID in colSort ? colSort[col.dataTypeID] : 'str';
    }

    function getVal(row, colName, colInfo) {
        var val = (colName in row && row[colName] !== null) ? row[colName] : '';
        if (colInfo.dataTypeID == dataTypes.BOOL && val == '') {
            val = 0;
        }
        if (val instanceof Date) {
            if (colInfo.dataTypeID == dataTypes.DATE) {
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

    function allowCrossOriginRequests(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        next();
    }

    router.get('/get.php', requireViewParameter, allowCrossOriginRequests, function (req, res) {
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
                var colList = [], colRef = {};
                var rowsEle = builder.create('rows', { encoding: 'UTF-8' });
                var headEle = rowsEle.ele('head');
                queryResult.fields.forEach(function (column) {
                    colList.push(column.name);
                    colRef[column.name] = column;
                    var isId = (column.name == idColumn);
                    var colEle = headEle.ele('column', {
                        'width': isId || !('default_width' in req.query) ? defaultColWidth : req.query.default_width,
                        'type': getColType(column) || ( column.dataTypeID in enumTypes ? 'coro' : 'ed' ),
                        'editable': false,
                        'align': isId ? 'right' : '*',
                        'sort': getColSort(column),
                        'color': isId ? '#CCE2FE' : ''
                    }, column.name);
                    if (column.dataTypeID in enumTypes) {
                        enumTypes[column.dataTypeID].forEach(function (enumLabel) { colEle.ele('option', { 'value': enumLabel }, enumLabel); });
                    }
                });
                queryResult.rows.forEach(function (row) {
                    var rowEle = rowsEle.ele('row', idColumn in row ? { 'id': row.id } : null);
                    colList.forEach(function (colName) {
                        rowEle.ele({ 'cell': { '#cdata': getVal(row, colName, colRef[colName]) } });
                    });
                });
                res.set('Content-Type', 'text/xml');
                res.send(rowsEle.end({ pretty: false }));
            })
            .catch(function (err) {
                res.status(500).send(err);
            });
    });

    router.post('/update.php', requireViewParameter, allowCrossOriginRequests, function (req, res) {
        if (!('ids' in req.body)) {
            return res.send(400).send('no ids in post data');
        }
        var ids = [], promises = [];
        req.body.ids.split(',').forEach(function (id) {
            ids.push(id);
            promises.push(db.select(req.query.view, " WHERE t." + idColumn + " = $1", [ id ])
                .then(function (result) {
                    if (!result.rows.length) {
                        return Promise.reject('row with id ' + id + ' disappeared');
                    }
                    var row = result.rows[0];
                    var tuples = [];
                    for (var i = 0; i < result.fields.length; i++) {
                        var column = result.fields[i];
                        var key = id + '_c' + i;
                        if (!(key in req.body)) {
                            return Promise.reject('missing key ' + key + ' in post data');
                        }
                        if (column.name == idColumn) {
                            continue;
                        }
                        var val = getVal(row, column.name, column);
                        if (req.body[key] != val) {
                            tuples.push([ column.name, !isTextCol(column) && req.body[key] == '' ? null : req.body[key] ]);
                        }
                    }
                    return tuples.length ? db.update(req.query.view, tuples, " WHERE " + idColumn + " = $", [ id ]) : false;
                })
            );
        });
        var dataEle = builder.create('data', { encoding: 'UTF-8' });
        Promise.all(promises)
            .then(function (results) {
                results.forEach(function (result, idx) {
                    dataEle.ele('action', { 'type': 'update', 'sid': ids[idx], 'tid': ids[idx] }, '');
                });
                res.send(dataEle.end({ pretty: false }));
            })
            .catch(function (err) {
                dataEle.ele('action', { 'type': 'error', 'sid': ids[0], 'tid': ids[0] }, err + '');
                res.send(dataEle.end({ pretty: false }));
            });
    });

    module.exports = router;
})(module);

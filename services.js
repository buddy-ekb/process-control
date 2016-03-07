(function (module) {

    var express = require('express');
    var builder = require('xmlbuilder');

    var router = express.Router();

    var db = require('./database');

    var idColumn = 'id';
    var defaultColWidth = 70;

    var dataTypes = {
        'DATE': 1082,
        'TEXT': 25,
        'INT': 23,
        'INT8': 20,
        'BOOL': 16,
        'NUMERIC': 1700,
        'VARCHAR': 1043
    };

    var colTypes = {};
    colTypes[dataTypes.INT] = 'edn';
    colTypes[dataTypes.INT8] = 'edn';
    colTypes[dataTypes.BOOL] = 'ch';
    colTypes[dataTypes.NUMERIC] = 'ed';
    colTypes[dataTypes.VARCHAR] = 'ed';
    colTypes[dataTypes.TEXT] = 'txt';
    colTypes[dataTypes.DATE] = 'dhxCalendar';

    var colSort = {};
    colSort[dataTypes.INT] = 'int';
    colSort[dataTypes.INT8] = 'int';
    colSort[dataTypes.BOOL] = 'int';
    colSort[dataTypes.DATE] = 'date';

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
            if (colInfo.dataTypeID != dataTypes.DATE)
                throw new Error('unsupported date type: ' + colInfo.dataTypeID);
            val = val.getDMY();
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

    router.get('/get.php', requireViewParameter, function (req, res) {
        var queryResult, unkTypes = {}, typeId = [];
        db.select(req.query.view)
            .then(function (result) {
                queryResult = result;
                var promises = [];
                result.fields
                    .filter(function (column) { return getColType(column) == null; })
                    .forEach(function (column) {
                        if (!(column.dataTypeID in unkTypes)) {
                            unkTypes[column.dataTypeID] = true;
                            promises.push(db.query("SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = $1", [ column.dataTypeID ]));
                            typeId.push(column.dataTypeID);
                        }
                    });
                return promises.length ? Promise.all(promises) : [];
            })
            .then(function (udtResults) {
                udtResults.forEach(function (udtResult, idx) {
                    unkTypes[typeId[idx]] = udtResult.rows.map(function (row) { return row.enumlabel; });
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
                        'type': getColType(column) || ( column.dataTypeID in unkTypes ? 'coro' : 'txt' ),
                        'editable': false,
                        'align': isId ? 'right' : '*',
                        'sort': getColSort(column),
                        'color': isId ? '#CCE2FE' : ''
                    }, column.name);
                    if (column.dataTypeID in unkTypes) {
                        unkTypes[column.dataTypeID].forEach(function (enumLabel) { colEle.ele('option', { 'value': enumLabel }, enumLabel); });
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

    router.post('/update.php', requireViewParameter, function (req, res) {
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
                            tuples.push([ column.name, req.body[key] ]);
                        }
                    }
                    return tuples.length ? db.update(req.query.view, tuples, " WHERE " + idColumn + " = $", [ id ]) : false;
                })
            );
        });
        Promise.all(promises)
            .then(function (results) {
                var dataEle = builder.create('data', { encoding: 'UTF-8' });
                results.forEach(function (result, idx) {
                    dataEle.ele('action', { 'type': 'update', 'sid': ids[idx], 'tid': ids[idx] }, '');
                });
                res.send(dataEle.end({ pretty: false }));
            })
            .catch(function (err) {
                res.status(500).send(err);
            });
    });

    module.exports = router;
})(module);

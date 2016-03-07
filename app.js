(function (module, console) {
    var express = require('express');
    var bodyParser = require('body-parser');

    require('./date');
    var config = require('./configuration');
    var db = require('./database');
    var services = require('./services');

    var app = express();

    app.use(bodyParser.urlencoded({ // to support URL-encoded bodies
        extended: true
    }));

    app.use('/', services);

    app.listen(config.http_port, function () {
        console.log('Express server listening on port ' + config.http_port);
    });
})(module, console);

(function (module, console) {
    var express = require('express');
    var bodyParser = require('body-parser');

    require('./date');
    var config = require('./configuration');
    var db = require('./database');
    var services = require('./services');

    var app = express();

    app.use(express.static(__dirname + '/web'));

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.use('/api', services);

    var server = app.listen(config.http_port, function () {
        console.log('Express server listening on port ' + config.http_port);
    });
    require('./iosock').init(server);
})(module, console);

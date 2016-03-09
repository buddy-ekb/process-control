(function (module) {
    var socketio = require('socket.io');
    var obj = {
	init: function (app) {
	    obj.io = socketio(app);
	}
    };
    module.exports = obj;
})(module);

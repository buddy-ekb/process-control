(function () {
    function a0(n) { return n < 10 ? '0' + n : n; }

    Date.prototype.getDMY = function () {
        return a0(this.getUTCDate()) + '/' + a0(this.getUTCMonth() + 1) + '/' + this.getUTCFullYear();
    };
})();

// utils/requestContext.js
const { AsyncLocalStorage } = require('async_hooks');
const mongoose = require('mongoose');

class RequestContext {
    constructor() {
        this.storage = new AsyncLocalStorage();
    }

    get() {
        return this.storage.getStore() || {};
    }

    getRequestId() {
        return this.get().requestId;
    }

    middleware() {
        return (req, res, next) => {
            const context = {
                requestId: new mongoose.Types.ObjectId(),
                timestamp: new Date(),
                pid: process.pid,
                userId: req.user?.id // if you have user info in request
            };
            this.storage.run(context, () => {
                next();
            });
        };
    }
}

module.exports = new RequestContext();

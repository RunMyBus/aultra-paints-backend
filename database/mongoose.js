const mongoose = require('mongoose');
const util = require('util');
const debug = require('debug')('express-mongoose-es6-rest-api:index');
const config = process.env;

let mongoUrl = '';
if (!config.DB_HOST) {
    console.error('mongo host is missing');
} else if (!config.DB_PORT) {
    console.error('mongo port is missing');
} else if (!config.DB_NAME) {
    console.error('mongo database is missing');
} else if (config.DB_USER && config.DB_PASS) {
    mongoUrl =
        'mongodb://' +
        config.DB_USER +
        ':' +
        config.DB_PASS +
        '@' +
        config.DB_HOST +
        '/' +
        config.DB_NAME;
} else {
    mongoUrl = 'mongodb://' + config.DB_HOST + ':' + config.DB_PORT + '/' + config.DB_NAME;
}
mongoose.connect(mongoUrl,)
    .then(() => console.log('Connected to MongoDB ' + mongoUrl))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });


// print mongoose logs in dev env
if (config.MONGOOSE_DEBUG) {
    mongoose.set('debug', (collectionName, method, query, doc) => {
        debug(`${collectionName}.${method}`, util.inspect(query, false, 20), doc);
    });
}

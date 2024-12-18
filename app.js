// config should be imported before importing any other file
require('dotenv').config();
config = process.env;
const app = require('./config/express');
require('./database/mongoose');


// module.parent check is required to support mocha watch
if (!module.parent) {
    app.listen(config.APP_RUNNING_PORT, () => {
        console.info(`server started on port ${config.APP_RUNNING_PORT} (${config.NODE_ENV})`);
    });
}

module.exports = app;

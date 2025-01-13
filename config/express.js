const path = require('path');
const express = require('express');
const session = require('express-session');
const httpError = require('http-errors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const compress = require('compression');
const methodOverride = require('method-override');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('../routes/index');
const passport = require('../middleware/passport');

const app = express();

app.use(session({
    secret: 'aultra-paints',
    resave: false,
    saveUninitialized: true,
    cookie: {}
}));

var distDir = '../../dist/';

// app.use(/^((?!(api)).)*/, (req, res) => {
//     res.sendFile(path.join(__dirname, distDir + '/index.html'));
// });
//
// app.use(/^((?!(api)).)*/, (req, res) => {
//     res.sendFile(path.join(__dirname, '../../dist/index.html'));
// });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(compress());
app.use(methodOverride());

// secure apps by setting various HTTP headers
app.use(helmet());

// Define allowed ports
const allowedOrigins = [
    'http://localhost:4300',
    'http://localhost:4400',
    'http://localhost:4200',
    'https://app.aultrapaints.com',
    'https://redeem.aultrapaints.com'
];

// Configure CORS
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true); // Allow the request
        } else {
            callback(new Error('Not allowed by CORS')); // Block the request
        }
    }
};

// enable CORS - Cross Origin Resource Sharing
app.use(cors(corsOptions));

app.use(passport.initialize());

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// API router
app.use('/api/', routes);

// catch 404 and forward to error handler
app.use((req, res, next) => {
    const err = new httpError(404);
    return next(err);
});

// error handler, send stacktrace only during development
app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
        message: err.message,
    });
    next(err);
});



module.exports = app;

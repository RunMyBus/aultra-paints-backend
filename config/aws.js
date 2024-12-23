const AWS = require('aws-sdk');

// Configure AWS SDK with your AWS credentials (make sure these are set correctly)
AWS.config.update({
    accessKeyId: 'YOUR_ACCESS_KEY',  // Replace with your access key
    secretAccessKey: 'YOUR_SECRET_KEY',  // Replace with your secret key
    region: 'YOUR_REGION'  // Replace with your AWS region
});

const s3 = new AWS.S3();
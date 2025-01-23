const AWS = require('aws-sdk');

// Configure AWS SDK with your AWS credentials (make sure these are set correctly)
AWS.config.update({
    accessKeyId: config.AWS_ACCESS_KEY_Id,  // Replace with your access key
    secretAccessKey: config.AWS_SECRETACCESSKEY,  // Replace with your secret key
    region: config.REGION,  // Replace with your AWS region
    endpoint: config.bucket_endpoint
});

const s3 = new AWS.S3();

module.exports = s3;
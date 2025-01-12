function decodeBase64Image(dataString) {
    const matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const response = {};

    if (matches.length !== 3) {
        return new Error('Invalid input string');
    }

    response.type = matches[1];
    response.data = Buffer.from(matches[2], 'base64');

    return response;
}

exports.decodeBase64Image = decodeBase64Image
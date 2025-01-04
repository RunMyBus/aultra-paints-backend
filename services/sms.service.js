const http = require('http'); // Or you can use 'https' if the URL is HTTPS
const querystring = require('querystring');

const username = 'OTPDEMOO';
const apikey = 'C8BFB-675D9';
const mobile = '9890098900';
const message = 'SMS MESSAGE';
const sender = 'INFOSM';
const apirequest = 'Text';
const route = 'TRANS';
const templateid = '1707165538475778811';

// Make the HTTP request
exports.smsFunction = async (req, res) => {
    try {
        const params = {
            username: username,
            apikey: apikey,
            apirequest: "Text",
            route: "TRANS",
            sender: "ROHIAL",
            mobile: "9030989698",
            TemplateID: templateid,
            message: "SMS MESSAGE",
        };

        const queryParams = querystring.stringify(params);

        const requestUrl = `http://sms.infrainfotech.com/sms-panel/api/http/index.php?${queryParams}`;
        console.log('Request URL:', requestUrl);
        http.get(requestUrl, (response) => {
            let data = '';

            // Collect response data
            response.on('data', (chunk) => {
                data += chunk;
            });

            // On response end
            response.on('end', () => {
                console.log('Response:', data);
            });
        }).on('error', (err) => {
            console.error('Error:', err.message);
            return res({ error: err.message });
        });
        return res({ message: 'SMS sent successfully' });
    } catch (error) {
        console.error('Error sending SMS:', error);
        return res({ error: 'Failed to send SMS' });
    }
}

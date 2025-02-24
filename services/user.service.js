const StaticPhoneNumbers = require('../models/staticPhoneNumbers')
const UserLoginSMSModel = require('../models/UserLoginSMS')

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const validateAndCreateOTP = async (mobile) => {
    try {
        const staticPhoneNumbers = await StaticPhoneNumbers.find();
        const mobileNumbers = staticPhoneNumbers.map(doc => doc.mobile);
        const OTP_EXPIRY_MINUTES = 10;
        let OTP;
        let isStatic = false;
        const expiryTime = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        // Check if mobile is app store user
        if (mobile === config.STATIC_MOBILE_NUMBER || mobile === config.STATIC_TEST_MOBILE_NUMBER) {
            OTP = config.STATIC_OTP;
            isStatic = true;
        }
        // Check if mobile is in staticPhoneNumbers
        else if (mobileNumbers.includes(mobile)) {
            OTP = '123456';
            isStatic = true;
        }
        // Generate new OTP for other numbers
        else {
            OTP = generateOTP();
        }

        // Create record in database
        await UserLoginSMSModel.create({
            mobile: mobile,
            otp: OTP,
            expiryTime
        });

        return {
            OTP,
            isStatic
        };
    } catch (error) {
        console.error("Error in generateAndCreateOTP:", error);
        throw error;
    }
}

module.exports = {
    validateAndCreateOTP
}

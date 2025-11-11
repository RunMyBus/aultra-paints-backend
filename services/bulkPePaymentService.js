const axios = require('axios');
const CashFreeTransaction = require('../models/CashFreeTransaction');
const CommonFunctions = require('../utils/CommonFuctions');
const logger = require('../utils/logger');
const config = process.env;

const apiKey = config.BULK_PE_API_KEY;
const apiURL = config.BULK_PE_API_URL;

const fetchBalance = async () => {
    try {
        logger.info('Getting BulkPe account balance');
        const response = await axios.get(`${apiURL}/fetchBalance`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (response.data.statusCode === 200 || response.data.status === true) {
            const availableBalance = parseFloat(response.data?.data?.Balance) || 0;
            logger.info('Successfully received BulkPe account balance.', {
                availableBalance: availableBalance
            });
            return availableBalance;
        } else {
            logger.error('BulkPe - fetchBalance api error.', response.data);
            throw new Error(response.data?.message || 'Error while fetching balance from BulkPe.');
        }
    } catch (error) {
        logger.error('Error fetching balance from BulkPe:', {
            error: error
        });
        throw error;
    }
};

const makeUPIPayment = async (upi, beneficiaryName, cash) => {
    try {
        let transferId = await CommonFunctions.sanitize(upi);
        transferId = `${transferId}_${Date.now()}`;

        const requestBody = JSON.stringify({
            amount: cash,
            account_number: "",
            payment_mode: "UPI",
            reference_id: transferId,
            transcation_note: "",
            beneficiaryName,
            ifsc: "",
            upi
        });

        const apiConfig = {
            method: 'post',
            maxBodyLength: Infinity,
            url: `${apiURL}/initiatepayout`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            data: requestBody
        };

        const response = await axios.request(apiConfig);
        const resData = response.data;

        // Handle any non-200 status code
        if (response.status !== 200) {
            logger.error(`BulkPe Payment failed 1: { ${upi} ${beneficiaryName} ${cash} }`,{
                error: resData
            });
            return {
                status: 400,
                message: 'Error while making payment using BulkPe.'
            };
        }

        // Handle invalid response or failure
        if (!resData || resData?.statusCode === 400 || resData.status === false) {
            let msg = resData?.message || 'Error while making payment.';

            // handle specific UPI invalid messages
            if (/incorrect|invalid|virtual|address|vpa|upi/i.test(msg)) {
                msg = 'Invalid UPI ID. Please enter correct UPI ID.';
            }

            logger.error(`Payment failed 2: ${msg} { ${upi} ${beneficiaryName} ${cash} }`,{
                error: resData
            });

            return {
                status: 400,
                message: msg
            };
        }

        const data = resData?.data || {};

        if (data?.status.toLowerCase() === 'failed') {
            let msg = resData?.message || data?.message || 'Error while making payment.';

            // handle specific insufficient balance messages
            if (/insufficient|balance/i.test(msg)) {
                msg = resData.message;
            }

            logger.error(`Payment failed 3: ${msg} { ${upi} ${beneficiaryName} ${cash} }`,{
                error: resData
            });
            return {
                status: 400,
                message: msg
            }
        }

        const transaction = await CashFreeTransaction.create({
            transfer_id: data?.reference_id || transferId,
            cf_transfer_id: data?.transcation_id || '',
            status: data?.status || '',
            status_code: resData?.statusCode?.toString() || '',
            status_description: resData?.message || '',
            beneficiary_details: {
                beneCode: data?.beneCode || '',
                beneName: data?.beneName || '',
                beneAccNum: data?.beneAccNum || '',
                beneIfscCode: data?.beneIfscCode || '',
                beneAcType: data?.beneAcType || ''
            },
            transfer_amount: data?.amount || cash,
            transfer_mode: data?.payment_mode || 'UPI',
            transfer_utr: data?.utr || '',
            added_on: new Date().toISOString(),
            updated_on: new Date().toISOString(),
            event_time: new Date().toISOString(),
            event_type: 'UPI_PAYMENT'
        });

        logger.info(`Payment initiated successfully. Transaction ID: ${transaction._id} Transfer ID: ${transferId}`);
        return {
            status: 200,
            message: 'Payment initiated successfully.'
        };

    } catch (error) {
        logger.error(`Exception in makeUPIPayment: ${error.message}`, error);
        throw error;
    }
};

const upiPayment = async (upi, beneficiaryName, cash) => {
    try {
        const balance = await fetchBalance();
        if (balance < cash) {
            return { success: false, message: 'BulkPe - Insufficient balance. Contact Admin.' };
        }
        // Make upi payment
        const paymentResult = await makeUPIPayment(upi, beneficiaryName, cash);
        if (paymentResult.status === 400) {
            logger.error('Error while making upi payment using BulkPe.', {
                error: paymentResult
            });
            return { success: false, message: paymentResult.message };
        }else if (paymentResult.status === 200) {
            logger.info('BulkPe UPI payment successful.');
            return { success: true, message: paymentResult.message };
        }else {
            logger.error('Error while making upi payment using BulkPe.', {
                error: paymentResult
            });
            return { success: false, message: paymentResult.message };
        }
    } catch (error) {
        logger.error(`Exception in upiPayment using BulkPe: ${error?.message}`, error);
        return {
            status: 400,
            message: error?.message || 'Error while making payment via BulkPe.'
        };
    }
}

module.exports = { fetchBalance, upiPayment, makeUPIPayment };

